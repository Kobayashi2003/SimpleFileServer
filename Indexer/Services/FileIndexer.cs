using Microsoft.Extensions.Logging;
using NtfsIndexer.Database;
using NtfsIndexer.Models;
using NtfsIndexer.Utils;

namespace NtfsIndexer.Services;

public class FileIndexer
{
    private readonly IndexDatabase _database;
    private readonly ILogger<FileIndexer> _logger;
    private readonly MimeTypeHelper _mimeTypeHelper;
    private readonly string _baseDirectory;
    private readonly bool _useRelativePaths;
    private int _processedFiles = 0;
    private readonly object _lockObj = new();

    public FileIndexer(IndexDatabase database, ILogger<FileIndexer> logger, MimeTypeHelper mimeTypeHelper, string baseDirectory, bool useRelativePaths = true)
    {
        _database = database;
        _logger = logger;
        _mimeTypeHelper = mimeTypeHelper;
        _baseDirectory = Path.GetFullPath(baseDirectory);
        _useRelativePaths = useRelativePaths;
        
        _logger.LogInformation("FileIndexer initialized with base directory: {BaseDirectory}, use relative paths: {UseRelativePaths}", 
            _baseDirectory, _useRelativePaths);
    }

    public async Task BuildInitialIndexAsync(CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Starting initial index build for: {Path}", _baseDirectory);
        
        try
        {
            var entries = new List<FileEntry>();
            
            // Process the root directory
            var rootInfo = new DirectoryInfo(_baseDirectory);
            if (rootInfo.Exists)
            {
                // Only add root directory to database if not using relative paths
                if (!_useRelativePaths)
                {
                    var rootEntry = await CreateFileEntryAsync(rootInfo, cancellationToken);
                    entries.Add(rootEntry);
                    UpdateProgress();
                }

                // Process all subdirectories and files
                await ProcessDirectoryAsync(_baseDirectory, entries, cancellationToken);
            }

            // Save remaining entries
            if (entries.Count > 0)
            {
                _database.InsertFileEntries(entries);
            }

            // Update metadata
            _database.UpdateMetadata("last_built", DateTime.Now.ToString("O"));
            _database.UpdateMetadata("base_directory", _baseDirectory);
            _database.UpdateMetadata("use_relative_paths", _useRelativePaths.ToString());
            _database.UpdateMetadata("total_processed", _processedFiles.ToString());
            
            _logger.LogInformation("Initial index build completed. Processed {ProcessedFiles} items", _processedFiles);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during initial index build");
            throw;
        }
    }

    public async Task UpdateFileEntryAsync(string filePath, CancellationToken cancellationToken = default)
    {
        try
        {
            var fileInfo = new FileInfo(filePath);
            var dirInfo = new DirectoryInfo(filePath);
            
            FileSystemInfo fsInfo = fileInfo.Exists ? fileInfo : dirInfo.Exists ? dirInfo : null!;
            
            if (fsInfo == null)
            {
                // File/directory doesn't exist, delete from index
                var pathToDelete = _useRelativePaths ? GetRelativePath(filePath) : filePath;
                _database.DeleteEntry(pathToDelete);
                _logger.LogDebug("Deleted non-existent file from index: {Path}", pathToDelete);
                return;
            }

            var entry = await CreateFileEntryAsync(fsInfo, cancellationToken);
            _database.InsertFileEntry(entry);
            
            _logger.LogDebug("Updated index entry: {Path}", entry.FullPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating file entry: {Path}", filePath);
        }
    }

    public async Task UpdateDirectoryEntryAsync(string directoryPath, CancellationToken cancellationToken = default)
    {
        try
        {
            var entries = new List<FileEntry>();
            var dirInfo = new DirectoryInfo(directoryPath);
            
            if (!dirInfo.Exists)
            {
                // Directory doesn't exist, delete from index
                var pathToDelete = _useRelativePaths ? GetRelativePath(directoryPath) : directoryPath;
                _database.DeleteEntriesWithPrefix(pathToDelete);
                _logger.LogDebug("Deleted non-existent directory from index: {Path}", pathToDelete);
                return;
            }

            // Add the directory entry itself
            var dirEntry = await CreateFileEntryAsync(dirInfo, cancellationToken);
            entries.Add(dirEntry);
            UpdateProgress();

            // Process all contents recursively
            await ProcessDirectoryAsync(directoryPath, entries, cancellationToken);

            // Save all entries
            if (entries.Count > 0)
            {
                _database.InsertFileEntries(entries);
            }
            
            _logger.LogDebug("Updated directory entry and its contents: {Path}", directoryPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error updating directory entry: {Path}", directoryPath);
        }
    }

    public void DeleteFileEntry(string filePath)
    {
        try
        {
            var pathToDelete = _useRelativePaths ? GetRelativePath(filePath) : filePath;
            _database.DeleteEntry(pathToDelete);
            _logger.LogDebug("Deleted file entry: {Path}", pathToDelete);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting file entry: {Path}", filePath);
        }
    }

    public void DeleteDirectoryEntries(string directoryPath)
    {
        try
        {
            var pathToDelete = _useRelativePaths ? GetRelativePath(directoryPath) : directoryPath;
            _database.DeleteEntriesWithPrefix(pathToDelete);
            _logger.LogDebug("Deleted directory entries: {Path}", pathToDelete);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error deleting directory entries: {Path}", directoryPath);
        }
    }

    private async Task<FileEntry> CreateFileEntryAsync(FileSystemInfo fsInfo, CancellationToken cancellationToken)
    {
        var entry = new FileEntry
        {
            FileName = fsInfo.Name,
            Extension = Path.GetExtension(fsInfo.Name).ToLowerInvariant(),
            CreationTime = fsInfo.CreationTime,
            LastWriteTime = fsInfo.LastWriteTime,
            LastAccessTime = fsInfo.LastAccessTime,
            IsDirectory = fsInfo is DirectoryInfo,
            Attributes = fsInfo.Attributes,
            IndexedTime = DateTime.Now
        };

        if (_useRelativePaths)
        {
            entry.FullPath = GetRelativePath(fsInfo.FullName);
            entry.ParentPath = GetRelativePath(Path.GetDirectoryName(fsInfo.FullName));
        }
        else
        {
            entry.FullPath = fsInfo.FullName;
            entry.ParentPath = Path.GetDirectoryName(fsInfo.FullName);
        }

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
            // Process all files in the current directory
            foreach (var file in Directory.GetFiles(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                
                var fileInfo = new FileInfo(file);
                var entry = await CreateFileEntryAsync(fileInfo, cancellationToken);
                entries.Add(entry);
                UpdateProgress();

                // Save in batches to avoid memory issues
                if (entries.Count >= 1000)
                {
                    _database.InsertFileEntries(entries);
                    entries.Clear();
                }
            }

            // Process all subdirectories
            foreach (var dir in Directory.GetDirectories(path))
            {
                cancellationToken.ThrowIfCancellationRequested();
                
                var dirInfo = new DirectoryInfo(dir);
                var entry = await CreateFileEntryAsync(dirInfo, cancellationToken);
                entries.Add(entry);
                UpdateProgress();

                // Recursively process subdirectories
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
            // Normalize both paths to ensure consistent comparison
            var normalizedAbsolutePath = Path.GetFullPath(absolutePath);
            var normalizedBaseDirectory = Path.GetFullPath(_baseDirectory);
            
            // Ensure both paths end with directory separator for consistent comparison
            if (!normalizedBaseDirectory.EndsWith(Path.DirectorySeparatorChar))
            {
                normalizedBaseDirectory += Path.DirectorySeparatorChar;
            }
            
            // Also ensure absolute path ends with separator if it's a directory
            if (Directory.Exists(normalizedAbsolutePath) && !normalizedAbsolutePath.EndsWith(Path.DirectorySeparatorChar))
            {
                normalizedAbsolutePath += Path.DirectorySeparatorChar;
            }
            
            if (normalizedAbsolutePath.StartsWith(normalizedBaseDirectory, StringComparison.OrdinalIgnoreCase))
            {
                var relativePath = normalizedAbsolutePath.Substring(normalizedBaseDirectory.Length);
                return relativePath.Replace('\\', '/');
            }
            
            _logger.LogWarning("Path {Path} is not under base directory {BaseDirectory}", absolutePath, _baseDirectory);
            return absolutePath.Replace('\\', '/');
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting path {Path} to relative path", absolutePath);
            return absolutePath.Replace('\\', '/');
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
} 