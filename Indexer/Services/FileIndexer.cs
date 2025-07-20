using Microsoft.Extensions.Logging;
using NtfsIndexer.Database;
using NtfsIndexer.Models;
using NtfsIndexer.Utils;
using System.Collections.Concurrent;
using System.Threading.Channels;

namespace NtfsIndexer.Services;

public class FileIndexer
{
    private readonly IndexDatabase _database;
    private readonly ILogger<FileIndexer> _logger;
    private readonly MimeTypeHelper _mimeTypeHelper;
    private readonly string _baseDirectory;
    private int _processedFiles = 0;
    private readonly object _lockObj = new();
    private readonly int _maxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount);

    public FileIndexer(IndexDatabase database, ILogger<FileIndexer> logger, MimeTypeHelper mimeTypeHelper, string baseDirectory)
    {
        _database = database;
        _logger = logger;
        _mimeTypeHelper = mimeTypeHelper;
        _baseDirectory = Path.GetFullPath(baseDirectory);
        
        _logger.LogInformation("FileIndexer initialized with base directory: {BaseDirectory}, using relative paths", 
            _baseDirectory);
    }

    public async Task BuildInitialIndexAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting initial index build for: {Path}", _baseDirectory);
        
        try
        {
            var lastBuilt = _database.GetMetadata("last_built");
            var storedBaseDirectory = _database.GetMetadata("base_directory");
            
            if (!string.IsNullOrEmpty(lastBuilt))
            {
                if (!string.IsNullOrEmpty(storedBaseDirectory) && storedBaseDirectory != _baseDirectory)
                {
                    _logger.LogWarning("Base directory changed from {OldPath} to {NewPath}. Forcing rebuild...", 
                        storedBaseDirectory, _baseDirectory);
                }
                else
                {
                    _logger.LogInformation("Existing index found, built on: {LastBuilt}", lastBuilt);
                    _logger.LogInformation("Index already exists, skipping rebuild. Use --force to rebuild.");
                    return;
                }
            }

            _database.ClearIndex();
            _logger.LogInformation("Cleared existing index data");

            var rootInfo = new DirectoryInfo(_baseDirectory);
            if (rootInfo.Exists)
            {
                await ProcessDirectoryParallelAsync(_baseDirectory, cancellationToken);
            }

            _database.UpdateMetadata("last_built", DateTime.Now.ToString("O"));
            _database.UpdateMetadata("base_directory", _baseDirectory);
            
            Console.WriteLine($"\rIndex build completed. Total indexed items: {_processedFiles:N0}");
            
            _logger.LogInformation("Initial index build completed. Processed {ProcessedFiles} items", _processedFiles);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during initial index build");
            throw;
        }
    }

    public async Task IndexItemAsync(string itemPath, bool recursive = false, CancellationToken cancellationToken = default)
    {
        try
        {
            var fileInfo = new FileInfo(itemPath);
            var dirInfo = new DirectoryInfo(itemPath);
            
            FileSystemInfo fsInfo = fileInfo.Exists ? fileInfo : dirInfo.Exists ? dirInfo : null!;
            
            if (fsInfo == null)
            {
                var pathToDelete = GetRelativePath(itemPath);
                _database.DeleteEntry(pathToDelete);
                _logger.LogDebug("Deleted non-existent item from index: {Path}", pathToDelete);
                return;
            }

            if (fsInfo is DirectoryInfo && recursive)
            {
                await IndexDirectoryRecursively(itemPath, cancellationToken);
            }
            else
            {
                var entry = await CreateFileEntryAsync(fsInfo, cancellationToken);
                _database.InsertFileEntry(entry);
                _logger.LogDebug("Indexed item: {Path}", entry.Path);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error indexing item: {Path}", itemPath);
        }
    }

    private async Task IndexDirectoryRecursively(string directoryPath, CancellationToken cancellationToken)
    {
        var entries = new List<FileEntry>();
        var dirInfo = new DirectoryInfo(directoryPath);
        
        if (!dirInfo.Exists)
        {
            var pathToDelete = GetRelativePath(directoryPath);
            _database.DeleteEntriesWithPrefix(pathToDelete);
            _logger.LogDebug("Deleted non-existent directory from index: {Path}", pathToDelete);
            return;
        }

        var dirEntry = await CreateFileEntryAsync(dirInfo, cancellationToken);
        entries.Add(dirEntry);
        UpdateProgress();

        await ProcessDirectoryAsync(directoryPath, entries, cancellationToken);

        if (entries.Count > 0)
        {
            _database.InsertFileEntries(entries);
        }
        
        _logger.LogDebug("Indexed directory recursively: {Path}", directoryPath);
    }

    public void DeleteItemEntry(string itemPath, bool recursive = false)
    {
        try
        {
            var pathToDelete = GetRelativePath(itemPath);
            
            if (recursive)
            {
                _database.DeleteEntriesWithPrefix(pathToDelete);
                _logger.LogDebug("Deleted item and all subentries: {Path}", pathToDelete);
            }
            else
            {
                _database.DeleteEntry(pathToDelete);
                _logger.LogDebug("Deleted single item entry: {Path}", pathToDelete);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting item entry: {Path}", itemPath);
        }
    }

    private async Task<FileEntry> CreateFileEntryAsync(FileSystemInfo fsInfo, CancellationToken cancellationToken)
    {
        var entry = new FileEntry
        {
            FileName = fsInfo.Name,
            LastWriteTime = fsInfo.LastWriteTime,
            IsDirectory = fsInfo is DirectoryInfo
        };

        entry.Path = GetRelativePath(fsInfo.FullName);

        if (fsInfo is FileInfo fileInfo)
        {
            entry.Size = fileInfo.Length;
            entry.MimeType = await _mimeTypeHelper.GetMimeTypeAsync(fileInfo.FullName, cancellationToken);
        }
        else
        {
            entry.Size = 0;
            entry.MimeType = "inode/directory";
        }

        return entry;
    }

    private async Task ProcessDirectoryAsync(string path, List<FileEntry> entries, CancellationToken cancellationToken)
    {
        try
        {
            foreach (var file in Directory.GetFiles(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                
                var fileInfo = new FileInfo(file);
                var entry = await CreateFileEntryAsync(fileInfo, cancellationToken);
                entries.Add(entry);
                UpdateProgress();

                if (entries.Count >= 1000)
                {
                    _database.InsertFileEntries(entries);
                    entries.Clear();
                }
            }

            foreach (var dir in Directory.GetDirectories(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                
                var dirInfo = new DirectoryInfo(dir);
                var entry = await CreateFileEntryAsync(dirInfo, cancellationToken);
                entries.Add(entry);
                UpdateProgress();

                await ProcessDirectoryAsync(dir, entries, cancellationToken);
            }
        }
        catch (UnauthorizedAccessException ex)
        {
            _logger.LogWarning("Access denied to directory: {Path} - {Message}", path, ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing directory: {Path}", path);
        }
    }

    private string GetRelativePath(string? absolutePath)
    {
        if (string.IsNullOrEmpty(absolutePath)) return string.Empty;
        
        try
        {
            var normalizedAbsolutePath = Path.GetFullPath(absolutePath);
            var normalizedBaseDirectory = Path.GetFullPath(_baseDirectory);
            
            if (!normalizedBaseDirectory.EndsWith(Path.DirectorySeparatorChar))
            {
                normalizedBaseDirectory += Path.DirectorySeparatorChar;
            }
            
            if (normalizedAbsolutePath.StartsWith(normalizedBaseDirectory, StringComparison.OrdinalIgnoreCase))
            {
                var relativePath = normalizedAbsolutePath.Substring(normalizedBaseDirectory.Length);
                relativePath = relativePath.Replace('\\', '/').TrimEnd('/');
                return relativePath;
            }
            
            _logger.LogWarning("Path {Path} is not under base directory {BaseDirectory}", absolutePath, _baseDirectory);
            return absolutePath.Replace('\\', '/').TrimEnd('/');
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting path {Path} to relative path", absolutePath);
            return absolutePath.Replace('\\', '/').TrimEnd('/');
        }
    }

    public bool? IsDirectoryInDatabase(string absolutePath)
    {
        try
        {
            var pathToQuery = GetRelativePath(absolutePath);
            var entry = _database.GetEntry(pathToQuery);
            return entry?.IsDirectory;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking directory status for path: {Path}", absolutePath);
            return null;
        }
    }

    private void UpdateProgress()
    {
        lock (_lockObj)
        {
            _processedFiles++;
            if (_processedFiles % 100 == 0)
            {
                Console.Write($"\rProcessed: {_processedFiles:N0} items");
            }
        }
    }

    private async Task ProcessDirectoryParallelAsync(string rootPath, CancellationToken cancellationToken)
    {
        const int batchSize = 1000;
        const int channelCapacity = 10000;

        var channel = Channel.CreateBounded<FileEntry>(channelCapacity);
        var writer = channel.Writer;
        var reader = channel.Reader;

        var writerTask = Task.Run(async () =>
        {
            var batch = new List<FileEntry>(batchSize);
            
            await foreach (var entry in reader.ReadAllAsync(cancellationToken))
            {
                batch.Add(entry);
                
                if (batch.Count >= batchSize)
                {
                    _database.InsertFileEntries(batch);
                    batch.Clear();
                }
            }
            
            if (batch.Count > 0)
            {
                _database.InsertFileEntries(batch);
            }
        }, cancellationToken);

        try
        {
            var directories = new ConcurrentQueue<string>();
            directories.Enqueue(rootPath);
            
            await ProcessDirectoryFilesAsync(rootPath, writer, cancellationToken);
            
            var processedDirs = new ConcurrentBag<string>();
            
            await Task.Run(async () =>
            {
                var parallelOptions = new ParallelOptions
                {
                    CancellationToken = cancellationToken,
                    MaxDegreeOfParallelism = _maxDegreeOfParallelism
                };

                await Parallel.ForEachAsync(
                    GetAllDirectoriesAsync(rootPath, cancellationToken),
                    parallelOptions,
                    async (directory, ct) =>
                    {
                        try
                        {
                            await ProcessDirectoryFilesAsync(directory, writer, ct);
                            processedDirs.Add(directory);
                        }
                        catch (UnauthorizedAccessException ex)
                        {
                            _logger.LogWarning("Access denied to directory: {Path} - {Message}", directory, ex.Message);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError(ex, "Error processing directory: {Path}", directory);
                        }
                    });
            }, cancellationToken);
        }
        finally
        {
            writer.Complete();
            await writerTask;
        }
    }

    private async IAsyncEnumerable<string> GetAllDirectoriesAsync(string rootPath, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var queue = new Queue<string>();
        queue.Enqueue(rootPath);

        while (queue.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            
            var currentDir = queue.Dequeue();
            yield return currentDir;

            try
            {
                await Task.Yield();
                
                foreach (var subDir in Directory.GetDirectories(currentDir))
                {
                    queue.Enqueue(subDir);
                }
            }
            catch (UnauthorizedAccessException)
            {
                // Skip directories without access permission
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error enumerating directory: {Path}", currentDir);
            }
        }
    }

    private async Task ProcessDirectoryFilesAsync(string directoryPath, ChannelWriter<FileEntry> writer, CancellationToken cancellationToken)
    {
        try
        {
            var dirInfo = new DirectoryInfo(directoryPath);
            if (!dirInfo.Exists) return;

            var dirEntry = await CreateFileEntryAsync(dirInfo, cancellationToken);
            await writer.WriteAsync(dirEntry, cancellationToken);
            UpdateProgress();

            var fileTasks = Directory.GetFiles(directoryPath)
                .Select(async filePath =>
                {
                    try
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                        var fileInfo = new FileInfo(filePath);
                        var entry = await CreateFileEntryAsync(fileInfo, cancellationToken);
                        await writer.WriteAsync(entry, cancellationToken);
                        UpdateProgress();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error processing file: {Path}", filePath);
                    }
                });

            await Task.WhenAll(fileTasks);
        }
        catch (UnauthorizedAccessException ex)
        {
            _logger.LogWarning("Access denied to directory: {Path} - {Message}", directoryPath, ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing directory files: {Path}", directoryPath);
        }
    }
}