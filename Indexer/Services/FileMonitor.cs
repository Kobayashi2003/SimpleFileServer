using Microsoft.Extensions.Logging;
using NtfsIndexer.Database;

namespace NtfsIndexer.Services;

public class FileMonitor : IDisposable
{
    private readonly FileIndexer _fileIndexer;
    private readonly ILogger<FileMonitor> _logger;
    private FileSystemWatcher? _watcher;
    private readonly Dictionary<string, DateTime> _lastEvents = new();
    private readonly Dictionary<string, HashSet<string>> _processedChildEvents = new();
    private readonly TimeSpan _debounceInterval = TimeSpan.FromMilliseconds(500);
    private readonly TimeSpan _aggregationWindow = TimeSpan.FromSeconds(2);
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
                InternalBufferSize = 64 * 1024  // 64KB
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

    private bool HasRecentChildEvents(string directoryPath)
    {
        lock (_lockObj)
        {
            var now = DateTime.Now;
            
            var expiredKeys = _processedChildEvents.Keys
                .Where(key => !_processedChildEvents[key].Any() || 
                             _lastEvents.ContainsKey(key) && now - _lastEvents[key] > _aggregationWindow)
                .ToList();
            
            foreach (var key in expiredKeys)
            {
                _processedChildEvents.Remove(key);
            }
            
            return _processedChildEvents.ContainsKey(directoryPath) && 
                   _processedChildEvents[directoryPath].Any();
        }
    }

    private void MarkChildEventProcessed(string filePath, string eventType)
    {
        var parentPath = Path.GetDirectoryName(filePath);
        if (string.IsNullOrEmpty(parentPath)) return;
        
        lock (_lockObj)
        {
            if (!_processedChildEvents.ContainsKey(parentPath))
            {
                _processedChildEvents[parentPath] = new HashSet<string>();
            }
            
            _processedChildEvents[parentPath].Add($"{filePath}:{eventType}");
            
            _lastEvents[$"child:{parentPath}"] = DateTime.Now;
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
            if (Directory.Exists(e.FullPath))
            {
                if (HasRecentChildEvents(e.FullPath))
                {
                    await _fileIndexer.UpdateDirectoryMetadataOnlyAsync(e.FullPath);
                    _logger.LogDebug("Directory changed (metadata only): {Path}", e.FullPath);
                }
                else
                {
                    await _fileIndexer.UpdateDirectoryEntryAsync(e.FullPath);
                    _logger.LogDebug("Directory changed (full update): {Path}", e.FullPath);
                }
            }
            else
            {
                await _fileIndexer.UpdateFileEntryAsync(e.FullPath);
                _logger.LogDebug("File changed: {Path}", e.FullPath);
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
            MarkChildEventProcessed(e.FullPath, "Created");
            
            await _fileIndexer.UpdateFileEntryAsync(e.FullPath);
            _logger.LogDebug("File created: {Path}", e.FullPath);
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
            MarkChildEventProcessed(e.FullPath, "Deleted");
            
            if (Directory.Exists(e.FullPath))
            {
                _fileIndexer.DeleteDirectoryEntries(e.FullPath);
                _logger.LogDebug("Directory deleted: {Path}", e.FullPath);
            }
            else
            {
                _fileIndexer.DeleteFileEntry(e.FullPath);
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
            MarkChildEventProcessed(e.FullPath, "Renamed");
            
            if (Directory.Exists(e.FullPath))
            {
                _fileIndexer.DeleteDirectoryEntries(e.OldFullPath);
                await _fileIndexer.UpdateDirectoryEntryAsync(e.FullPath);
                _logger.LogDebug("Directory renamed: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
            }
            else
            {
                _fileIndexer.DeleteFileEntry(e.OldFullPath);
                await _fileIndexer.UpdateFileEntryAsync(e.FullPath);
                _logger.LogDebug("File renamed: {OldPath} -> {NewPath}", e.OldFullPath, e.FullPath);
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