using Microsoft.Extensions.Logging;
using Indexer2.Core;
using Indexer2.Services;
using System.Collections.Concurrent;

namespace Indexer2.Services;

public class FastFileIndexer : IDisposable
{
    private readonly IndexerConfig _config;
    private readonly ILogger<FastFileIndexer> _logger;
    private readonly ILoggerFactory _loggerFactory;
    private readonly IndexDatabase _database;
    private readonly FastMimeTypeDetector _mimeDetector;
    private readonly ConcurrentQueue<FileEntry> _pendingEntries;
    private readonly Timer _batchProcessor;
    private UsnJournalMonitor? _monitor;
    private int _processedFiles = 0;
    private readonly object _progressLock = new();

    public FastFileIndexer(IndexerConfig config, ILoggerFactory loggerFactory)
    {
        _config = config;
        _loggerFactory = loggerFactory;
        _logger = loggerFactory.CreateLogger<FastFileIndexer>();
        _database = new IndexDatabase(config.OutputDatabasePath, 
            loggerFactory.CreateLogger<IndexDatabase>());
        _mimeDetector = new FastMimeTypeDetector();
        _pendingEntries = new ConcurrentQueue<FileEntry>();
        
        // 批处理定时器
        _batchProcessor = new Timer(ProcessBatchEntries, null, 
            TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(500));
    }

    public async Task RunAsync()
    {
        try
        {
            _logger.LogInformation("Starting FastFileIndexer with config:");
            _logger.LogInformation("  Base Directory: {BaseDirectory}", _config.BaseDirectory);
            _logger.LogInformation("  Output Database: {OutputPath}", _config.OutputDatabasePath);
            _logger.LogInformation("  Use Relative Paths: {UseRelativePaths}", _config.UseRelativePaths);
            _logger.LogInformation("  Force Rebuild: {ForceRebuild}", _config.ForceRebuild);
            _logger.LogInformation("  Enable Monitoring: {EnableMonitoring}", _config.EnableMonitoring);

            // 检查基目录是否存在
            if (!Directory.Exists(_config.BaseDirectory))
            {
                _logger.LogError("Base directory does not exist: {BaseDirectory}", _config.BaseDirectory);
                return;
            }

            // 检查是否需要构建初始索引
            if (await ShouldBuildInitialIndex())
            {
                await BuildInitialIndexAsync();
            }
            else
            {
                _logger.LogInformation("Index is up to date, skipping rebuild");
            }

            // 启动监控（如果需要）
            if (_config.EnableMonitoring)
            {
                await StartMonitoringAsync();
                
                _logger.LogInformation("Monitoring started. Press Ctrl+C to stop.");
                
                // 等待取消信号
                var cancellationTokenSource = new CancellationTokenSource();
                Console.CancelKeyPress += (_, e) =>
                {
                    e.Cancel = true;
                    cancellationTokenSource.Cancel();
                };

                try
                {
                    await Task.Delay(Timeout.Infinite, cancellationTokenSource.Token);
                }
                catch (OperationCanceledException)
                {
                    _logger.LogInformation("Shutdown requested");
                }
            }

            _logger.LogInformation("FastFileIndexer completed successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Fatal error in FastFileIndexer");
            throw;
        }
    }

    private async Task<bool> ShouldBuildInitialIndex()
    {
        if (_config.ForceRebuild)
        {
            _logger.LogInformation("Force rebuild requested");
            return true;
        }

        var lastBuilt = _database.GetMetadata("last_built");
        var storedBaseDirectory = _database.GetMetadata("base_directory");
        var storedUseRelativePaths = _database.GetMetadata("use_relative_paths");

        if (string.IsNullOrEmpty(lastBuilt))
        {
            _logger.LogInformation("No existing index found, building initial index");
            return true;
        }

        // 检查配置是否发生变化
        if (storedBaseDirectory != _config.BaseDirectory)
        {
            _logger.LogWarning("Base directory changed from {OldPath} to {NewPath}, rebuilding index", 
                storedBaseDirectory, _config.BaseDirectory);
            return true;
        }

        if (!string.IsNullOrEmpty(storedUseRelativePaths) && 
            bool.Parse(storedUseRelativePaths) != _config.UseRelativePaths)
        {
            _logger.LogWarning("Path format changed, rebuilding index");
            return true;
        }

        _logger.LogInformation("Existing index found, built on: {LastBuilt}", lastBuilt);
        return false;
    }

    private async Task BuildInitialIndexAsync()
    {
        _logger.LogInformation("Building initial index for: {BaseDirectory}", _config.BaseDirectory);
        
        var startTime = DateTime.Now;
        _processedFiles = 0;

        try
        {
            // 清空现有索引
            _database.ClearIndex();
            _logger.LogInformation("Cleared existing index data");

            // 开始索引构建
            await ProcessDirectoryRecursively(_config.BaseDirectory);

            // 处理剩余的批次
            ProcessBatchEntries(null);

            // 更新元数据
            _database.UpdateMetadata("last_built", DateTime.Now.ToString("O"));
            _database.UpdateMetadata("base_directory", _config.BaseDirectory);
            _database.UpdateMetadata("use_relative_paths", _config.UseRelativePaths.ToString());

            var elapsed = DateTime.Now - startTime;
            var totalFiles = _database.GetFileCount();
            var totalDirs = _database.GetDirectoryCount();

            Console.WriteLine($"\rIndex build completed successfully!");
            Console.WriteLine($"Total indexed items: {_processedFiles:N0}");
            Console.WriteLine($"  Files: {totalFiles:N0}");
            Console.WriteLine($"  Directories: {totalDirs:N0}");
            Console.WriteLine($"Time elapsed: {elapsed.TotalMinutes:F1} minutes");
            Console.WriteLine($"Processing rate: {_processedFiles / elapsed.TotalSeconds:F0} items/second");

            _logger.LogInformation("Initial index build completed. Processed {ProcessedFiles} items in {ElapsedMinutes:F1} minutes", 
                _processedFiles, elapsed.TotalMinutes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during initial index build");
            throw;
        }
    }

    private async Task ProcessDirectoryRecursively(string directoryPath)
    {
        try
        {
            var dirInfo = new DirectoryInfo(directoryPath);
            if (!dirInfo.Exists) return;

            // 创建目录条目
            var dirEntry = await CreateFileEntryAsync(dirInfo);
            if (dirEntry != null)
            {
                _pendingEntries.Enqueue(dirEntry);
                UpdateProgress();
            }

            // 获取所有文件系统项目
            FileSystemInfo[] allItems;
            try
            {
                allItems = dirInfo.GetFileSystemInfos();
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning("Access denied to directory: {Path} - {Message}", directoryPath, ex.Message);
                return;
            }

            // 分离文件和目录
            var files = allItems.OfType<FileInfo>().ToArray();
            var directories = allItems.OfType<DirectoryInfo>().ToArray();

            // 并行处理文件
            if (files.Length > 0)
            {
                await ProcessFilesInParallel(files);
            }

            // 递归处理子目录
            foreach (var subDir in directories)
            {
                await ProcessDirectoryRecursively(subDir.FullName);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing directory: {Path}", directoryPath);
        }
    }

    private async Task ProcessFilesInParallel(FileInfo[] files)
    {
        var parallelOptions = new ParallelOptions
        {
            MaxDegreeOfParallelism = _config.MaxConcurrency
        };

        await Parallel.ForEachAsync(files, parallelOptions, async (file, cancellationToken) =>
        {
            try
            {
                var entry = await CreateFileEntryAsync(file);
                if (entry != null)
                {
                    _pendingEntries.Enqueue(entry);
                    UpdateProgress();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing file: {Path}", file.FullName);
            }
        });
    }

    private async Task<FileEntry?> CreateFileEntryAsync(FileSystemInfo fsInfo)
    {
        try
        {
            var extension = Path.GetExtension(fsInfo.Name).ToLowerInvariant();
            var mimeType = fsInfo is DirectoryInfo ? "inode/directory" : 
                          _mimeDetector.GetMimeType(fsInfo.FullName, extension);

            var entry = new FileEntry
            {
                FileName = fsInfo.Name,
                Extension = extension,
                CreationTime = fsInfo.CreationTime,
                LastWriteTime = fsInfo.LastWriteTime,
                LastAccessTime = fsInfo.LastAccessTime,
                IsDirectory = fsInfo is DirectoryInfo,
                Attributes = fsInfo.Attributes,
                IndexedTime = DateTime.Now,
                MimeType = mimeType,
                Size = fsInfo is FileInfo fileInfo ? fileInfo.Length : 0
            };

            if (_config.UseRelativePaths)
            {
                entry.FullPath = GetRelativePath(fsInfo.FullName);
                entry.ParentPath = GetRelativePath(Path.GetDirectoryName(fsInfo.FullName));
            }
            else
            {
                entry.FullPath = fsInfo.FullName;
                entry.ParentPath = Path.GetDirectoryName(fsInfo.FullName) ?? string.Empty;
            }

            return entry;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating file entry for: {Path}", fsInfo.FullName);
            return null;
        }
    }

    private string GetRelativePath(string? absolutePath)
    {
        if (string.IsNullOrEmpty(absolutePath)) return string.Empty;
        
        try
        {
            var normalizedAbsolutePath = Path.GetFullPath(absolutePath);
            var normalizedBaseDirectory = Path.GetFullPath(_config.BaseDirectory);
            
            if (!normalizedBaseDirectory.EndsWith(Path.DirectorySeparatorChar))
            {
                normalizedBaseDirectory += Path.DirectorySeparatorChar;
            }
            
            if (Directory.Exists(normalizedAbsolutePath) && !normalizedAbsolutePath.EndsWith(Path.DirectorySeparatorChar))
            {
                normalizedAbsolutePath += Path.DirectorySeparatorChar;
            }
            
            if (normalizedAbsolutePath.StartsWith(normalizedBaseDirectory, StringComparison.OrdinalIgnoreCase))
            {
                var relativePath = normalizedAbsolutePath.Substring(normalizedBaseDirectory.Length);
                return relativePath.Replace('\\', '/');
            }
            
            _logger.LogWarning("Path {Path} is not under base directory {BaseDirectory}", 
                absolutePath, _config.BaseDirectory);
            return absolutePath.Replace('\\', '/');
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error converting path {Path} to relative path", absolutePath);
            return absolutePath.Replace('\\', '/');
        }
    }

    private void ProcessBatchEntries(object? state)
    {
        var batch = new List<FileEntry>(_config.BatchSize);
        
        while (_pendingEntries.TryDequeue(out var entry) && batch.Count < _config.BatchSize)
        {
            batch.Add(entry);
        }

        if (batch.Count > 0)
        {
            try
            {
                _database.InsertFileEntries(batch);
                
                if (_config.VerboseLogging)
                {
                    _logger.LogDebug("Processed batch of {Count} entries", batch.Count);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing batch of {Count} entries", batch.Count);
                
                // 重新排队失败的项目
                foreach (var entry in batch)
                {
                    _pendingEntries.Enqueue(entry);
                }
            }
        }
    }

    private async Task StartMonitoringAsync()
    {
        try
        {
            _monitor = new UsnJournalMonitor(
                _database,
                _mimeDetector,
                _config.BaseDirectory,
                _config.UseRelativePaths,
                _loggerFactory.CreateLogger<UsnJournalMonitor>());

            await _monitor.StartMonitoringAsync();
            _logger.LogInformation("File system monitoring started");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start file system monitoring");
            throw;
        }
    }

    private void UpdateProgress()
    {
        lock (_progressLock)
        {
            _processedFiles++;
            if (_processedFiles % 1000 == 0)
            {
                Console.Write($"\rProcessed: {_processedFiles:N0} items");
            }
        }
    }

    public void Dispose()
    {
        _monitor?.Dispose();
        _batchProcessor?.Dispose();
        
        // 处理剩余的条目
        ProcessBatchEntries(null);
        
        _database?.Dispose();
        
        _logger.LogInformation("FastFileIndexer disposed");
    }
}
