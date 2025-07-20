using Microsoft.Extensions.Logging;
using NtfsIndexer.Database;

namespace NtfsIndexer.Services;

public class FileMonitor : IDisposable
{
    private readonly FileIndexer _fileIndexer;
    private readonly ILogger<FileMonitor> _logger;
    private FileSystemWatcher? _watcher;
    private readonly Dictionary<string, DateTime> _lastEvents = new();
    private readonly TimeSpan _debounceInterval = TimeSpan.FromMilliseconds(500);
    private readonly object _lockObj = new();
    private bool _disposed;

    public FileMonitor(FileIndexer fileIndexer, ILogger<FileMonitor> logger)
    {
        _fileIndexer = fileIndexer;
        _logger = logger;
    }

    public void StartMonitoring(string path)
    {
        if (_watcher != null)
        {
            StopMonitoring();
        }

        try
        {
            _watcher = new FileSystemWatcher(path)
            {
                NotifyFilter = NotifyFilters.Attributes
                              | NotifyFilters.CreationTime
                              | NotifyFilters.DirectoryName
                              | NotifyFilters.FileName
                              | NotifyFilters.LastWrite
                              | NotifyFilters.Size,
                IncludeSubdirectories = true,
                EnableRaisingEvents = true,
                InternalBufferSize = 64 * 1024 * 1024 // 64 MB
            };

            _watcher.Changed += OnChanged;
            _watcher.Created += OnCreated;
            _watcher.Deleted += OnDeleted;
            _watcher.Renamed += OnRenamed;
            _watcher.Error += OnError;

            _logger.LogInformation("Started monitoring directory: {Path}", path);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error starting file monitor for path: {Path}", path);
            throw;
        }
    }

    public void StopMonitoring()
    {
        if (_watcher != null)
        {
            _watcher.EnableRaisingEvents = false;
            _watcher.Dispose();
            _watcher = null;
            _logger.LogInformation("Stopped file monitoring");
        }
    }

    private bool ShouldProcessEvent(string path, string eventType)
    {
        lock (_lockObj)
        {
            var now = DateTime.Now;
            var eventKey = $"{path}:{eventType}";

            if (_lastEvents.TryGetValue(eventKey, out DateTime lastEvent))
            {
                if (now - lastEvent < _debounceInterval)
                {
                    return false;
                }
            }

            _lastEvents[eventKey] = now;
            
            if (_lastEvents.Count > 1000)
            {
                var cutoff = now - TimeSpan.FromMinutes(5);
                var keysToRemove = _lastEvents.Where(kvp => kvp.Value < cutoff).Select(kvp => kvp.Key).ToList();
                foreach (var key in keysToRemove)
                {
                    _lastEvents.Remove(key);
                }
            }

            return true;
        }
    }

    private async void OnChanged(object sender, FileSystemEventArgs e)
    {
        if (e.ChangeType != WatcherChangeTypes.Changed)
        {
            return;
        }

        if (!ShouldProcessEvent(e.FullPath, "Changed"))
        {
            return;
        }

        try
        {
            if (Directory.Exists(e.FullPath) || File.Exists(e.FullPath))
            {
                await _fileIndexer.IndexItemAsync(e.FullPath, recursive: false);
                _logger.LogDebug("Item metadata updated: {Path}", e.FullPath);
            }
            else
            {
                _logger.LogWarning("Changed item no longer exists: {Path}", e.FullPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling change: {Path}", e.FullPath);
        }
    }

    private async void OnCreated(object sender, FileSystemEventArgs e)
    {
        if (!ShouldProcessEvent(e.FullPath, "Created"))
        {
            return;
        }

        try
        {
            if (Directory.Exists(e.FullPath))
            {
                await _fileIndexer.IndexItemAsync(e.FullPath, recursive: true);
                _logger.LogDebug("Directory created and indexed: {Path}", e.FullPath);
            }
            else if (File.Exists(e.FullPath))
            {
                await _fileIndexer.IndexItemAsync(e.FullPath, recursive: false);
                _logger.LogDebug("File created and indexed: {Path}", e.FullPath);
            }
            else
            {
                _logger.LogWarning("Created item no longer exists: {Path}", e.FullPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling file creation: {Path}", e.FullPath);
        }
    }

    private void OnDeleted(object sender, FileSystemEventArgs e)
    {
        if (!ShouldProcessEvent(e.FullPath, "Deleted"))
        {
            return;
        }

        try
        {
            var isDirectory = _fileIndexer.IsDirectoryInDatabase(e.FullPath);
            
            if (isDirectory == true)
            {
                _fileIndexer.DeleteItemEntry(e.FullPath, recursive: true);
                _logger.LogDebug("Directory deleted: {Path}", e.FullPath);
            }
            else
            {
                _fileIndexer.DeleteItemEntry(e.FullPath, recursive: false);
                _logger.LogDebug("File deleted: {Path}", e.FullPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling file deletion: {Path}", e.FullPath);
        }
    }

    private async void OnRenamed(object sender, RenamedEventArgs e)
    {
        if (!ShouldProcessEvent(e.FullPath, "Renamed"))
        {
            return;
        }

        try
        {
            if (Directory.Exists(e.FullPath))
            {
                _fileIndexer.DeleteItemEntry(e.OldFullPath, recursive: true);
                await _fileIndexer.IndexItemAsync(e.FullPath, recursive: true);
                _logger.LogDebug("Directory renamed and reindexed: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
            }
            else if (File.Exists(e.FullPath))
            {
                _fileIndexer.DeleteItemEntry(e.OldFullPath, recursive: false);
                await _fileIndexer.IndexItemAsync(e.FullPath, recursive: false);
                _logger.LogDebug("File renamed and reindexed: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
            }
            else
            {
                _logger.LogWarning("Renamed item no longer exists: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
                _fileIndexer.DeleteItemEntry(e.OldFullPath, recursive: false);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling rename: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
        }
    }

    private void OnError(object sender, ErrorEventArgs e)
    {
        _logger.LogError(e.GetException(), "File system watcher error");
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            StopMonitoring();
            _disposed = true;
        }
        GC.SuppressFinalize(this);
    }
} 