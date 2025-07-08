using System;
using System.IO;
using System.Security.Permissions;
using System.Collections.Concurrent;

namespace NtfsIndexer;

class Program
{
    private static FileSystemWatcher? _watcher;
    
    static void Main(string[] args)
    {
        Console.WriteLine("NTFS File System Monitor");
        Console.WriteLine("------------------------");

        // Default to monitoring the current directory if no path is provided
        string pathToMonitor = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        
        try
        {
            _watcher = new FileSystemWatcher(pathToMonitor)
            {
                NotifyFilter = NotifyFilters.Attributes
                              | NotifyFilters.CreationTime
                              | NotifyFilters.DirectoryName
                              | NotifyFilters.FileName
                              | NotifyFilters.LastAccess
                              | NotifyFilters.LastWrite
                              | NotifyFilters.Security
                              | NotifyFilters.Size,
                IncludeSubdirectories = true,  // Monitor all subdirectories with a single watcher
                EnableRaisingEvents = true     // Start watching immediately
            };

            // Add event handlers
            _watcher.Changed += OnChanged;
            _watcher.Created += OnCreated;
            _watcher.Deleted += OnDeleted;
            _watcher.Renamed += OnRenamed;
            _watcher.Error += OnError;
            
            Console.WriteLine($"Monitoring directory tree: {pathToMonitor}");
            Console.WriteLine("Press 'q' to quit the application");

            while (Console.ReadKey().KeyChar != 'q') { }
            
            // Cleanup watcher
            _watcher.EnableRaisingEvents = false;
            _watcher.Dispose();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
        }
    }

    private static void OnChanged(object sender, FileSystemEventArgs e)
    {
        if (e.ChangeType != WatcherChangeTypes.Changed)
        {
            return;
        }
        LogEvent("Changed", e.FullPath);
    }

    private static void OnCreated(object sender, FileSystemEventArgs e)
    {
        LogEvent("Created", e.FullPath);
    }

    private static void OnDeleted(object sender, FileSystemEventArgs e)
    {
        LogEvent("Deleted", e.FullPath);
    }

    private static void OnRenamed(object sender, RenamedEventArgs e)
    {
        Console.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] Renamed:");
        Console.WriteLine($"    Old: {e.OldFullPath}");
        Console.WriteLine($"    New: {e.FullPath}");
    }

    private static void OnError(object sender, ErrorEventArgs e)
    {
        PrintException(e.GetException());
    }

    private static void PrintException(Exception? ex)
    {
        if (ex != null)
        {
            Console.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] Error:");
            Console.WriteLine($"Message: {ex.Message}");
            Console.WriteLine("Stacktrace:");
            Console.WriteLine(ex.StackTrace);
            PrintException(ex.InnerException);
        }
    }

    private static void LogEvent(string eventType, string path)
    {
        Console.WriteLine($"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {eventType}: {path}");
    }
} 