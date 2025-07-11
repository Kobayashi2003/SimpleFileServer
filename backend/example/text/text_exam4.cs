using System.Security.Principal;
using IndexBuilder.Database;
using IndexBuilder.Models;

namespace IndexBuilder;

class Program
{
    private static int _totalFiles = 0;
    private static int _processedFiles = 0;
    private static readonly object _lockObj = new();

    static async Task Main(string[] args)
    {
        Console.WriteLine("File System Index Builder");
        Console.WriteLine("------------------------");

        if (!IsAdministrator())
        {
            Console.WriteLine("Warning: Running without administrator privileges. Some files may not be accessible.");
        }

        // Default to monitoring the current directory if no path is provided
        string pathToIndex = args.Length > 0 ? args[0] : Directory.GetCurrentDirectory();
        string dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "file_index.db");

        try
        {
            // First count total files for progress reporting
            _totalFiles = Directory.GetFiles(pathToIndex, "*", SearchOption.AllDirectories).Length +
                         Directory.GetDirectories(pathToIndex, "*", SearchOption.AllDirectories).Length;

            Console.WriteLine($"Found {_totalFiles} items to index in {pathToIndex}");
            Console.WriteLine($"Database will be created at: {dbPath}");
            Console.WriteLine("Press any key to start indexing...");
            Console.ReadKey();

            using var db = new IndexDatabase(dbPath);
            var entries = new List<FileEntry>();
            
            // Start with the root directory
            var rootInfo = new DirectoryInfo(pathToIndex);
            var rootEntry = CreateFileEntry(rootInfo);
            entries.Add(rootEntry);
            UpdateProgress();

            // Process all files and directories
            await ProcessDirectory(pathToIndex, entries);

            // Save to database in batches
            Console.WriteLine("\nSaving to database...");
            db.InsertFileEntries(entries);

            Console.WriteLine($"\nIndexing complete! Processed {_processedFiles} items.");
            Console.WriteLine("Press any key to exit...");
            Console.ReadKey();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error: {ex.Message}");
            Console.WriteLine(ex.StackTrace);
        }
    }

    private static async Task ProcessDirectory(string path, List<FileEntry> entries)
    {
        try
        {
            // Process all files in the current directory
            foreach (var file in Directory.GetFiles(path))
            {
                var fileInfo = new FileInfo(file);
                entries.Add(CreateFileEntry(fileInfo));
                UpdateProgress();
            }

            // Process all subdirectories
            foreach (var dir in Directory.GetDirectories(path))
            {
                var dirInfo = new DirectoryInfo(dir);
                entries.Add(CreateFileEntry(dirInfo));
                UpdateProgress();

                // Recursively process subdirectories
                await ProcessDirectory(dir, entries);
            }

            // If the batch size gets too large, we might want to save to database
            if (entries.Count >= 1000)
            {
                await Task.Run(() =>
                {
                    using var db = new IndexDatabase(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "file_index.db"));
                    db.InsertFileEntries(entries);
                });
                entries.Clear();
            }
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.WriteLine($"\nAccess denied to {path}: {ex.Message}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\nError processing {path}: {ex.Message}");
        }
    }

    private static FileEntry CreateFileEntry(FileSystemInfo fsInfo)
    {
        var entry = new FileEntry
        {
            FullPath = fsInfo.FullName,
            FileName = fsInfo.Name,
            Extension = Path.GetExtension(fsInfo.Name),
            CreationTime = fsInfo.CreationTime,
            LastWriteTime = fsInfo.LastWriteTime,
            LastAccessTime = fsInfo.LastAccessTime,
            IsDirectory = fsInfo is DirectoryInfo,
            ParentPath = Path.GetDirectoryName(fsInfo.FullName),
            Attributes = fsInfo.Attributes
        };

        if (fsInfo is FileInfo fileInfo)
        {
            entry.Size = fileInfo.Length;
        }

        return entry;
    }

    private static void UpdateProgress()
    {
        lock (_lockObj)
        {
            _processedFiles++;
            var percentage = (_processedFiles * 100.0) / _totalFiles;
            Console.Write($"\rProgress: {percentage:F1}% ({_processedFiles}/{_totalFiles})");
        }
    }

    private static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }
} 