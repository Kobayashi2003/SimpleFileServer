using System.CommandLine;
using Microsoft.Extensions.Logging;
using NtfsIndexer.Database;
using NtfsIndexer.Services;
using NtfsIndexer.Utils;

namespace NtfsIndexer;

class Program
{
    static async Task<int> Main(string[] args)
    {
        // Configure logging
        using var loggerFactory = LoggerFactory.Create(builder =>
        {
            builder.AddConsole()
                   .SetMinimumLevel(LogLevel.Information);
        });

        var logger = loggerFactory.CreateLogger<Program>();

        // Create root command
        var rootCommand = new RootCommand("NTFS File System Indexer");

        // Build command
        var buildCommand = new Command("build", "Build initial file index");
        var buildPathArgument = new Argument<string>("path", "Path to index (default: current directory)")
        {
            Arity = ArgumentArity.ZeroOrOne
        };
        buildCommand.AddArgument(buildPathArgument);

        buildCommand.SetHandler(async (context) =>
        {
            var path = context.ParseResult.GetValueForArgument(buildPathArgument) ?? Directory.GetCurrentDirectory();
            await BuildIndexAsync(path, loggerFactory);
        });

        // Monitor command
        var monitorCommand = new Command("monitor", "Monitor file system changes");
        var monitorPathArgument = new Argument<string>("path", "Path to monitor (default: current directory)")
        {
            Arity = ArgumentArity.ZeroOrOne
        };
        monitorCommand.AddArgument(monitorPathArgument);

        monitorCommand.SetHandler(async (context) =>
        {
            var path = context.ParseResult.GetValueForArgument(monitorPathArgument) ?? Directory.GetCurrentDirectory();
            await MonitorAsync(path, loggerFactory);
        });

        // Full command (build + monitor)
        var fullCommand = new Command("full", "Build index and start monitoring");
        var fullPathArgument = new Argument<string>("path", "Path to index and monitor (default: current directory)")
        {
            Arity = ArgumentArity.ZeroOrOne
        };
        fullCommand.AddArgument(fullPathArgument);

        fullCommand.SetHandler(async (context) =>
        {
            var path = context.ParseResult.GetValueForArgument(fullPathArgument) ?? Directory.GetCurrentDirectory();
            await FullIndexAsync(path, loggerFactory);
        });

        // Search command
        var searchCommand = new Command("search", "Search indexed files");
        var searchTermArgument = new Argument<string>("term", "Search term");
        var limitOption = new Option<int>("--limit", () => 50, "Maximum number of results");
        searchCommand.AddArgument(searchTermArgument);
        searchCommand.AddOption(limitOption);

        searchCommand.SetHandler((context) =>
        {
            var term = context.ParseResult.GetValueForArgument(searchTermArgument);
            var limit = context.ParseResult.GetValueForOption(limitOption);
            SearchAsync(term, limit, loggerFactory);
        });

        // Status command
        var statusCommand = new Command("status", "Show indexer status");
        statusCommand.SetHandler((context) =>
        {
            ShowStatusAsync(loggerFactory);
        });

        // Add commands to root
        rootCommand.AddCommand(buildCommand);
        rootCommand.AddCommand(monitorCommand);
        rootCommand.AddCommand(fullCommand);
        rootCommand.AddCommand(searchCommand);
        rootCommand.AddCommand(statusCommand);

        return await rootCommand.InvokeAsync(args);
    }

    private static async Task BuildIndexAsync(string path, ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("BuildIndex");
        var dbLogger = loggerFactory.CreateLogger<IndexDatabase>();
        var indexerLogger = loggerFactory.CreateLogger<FileIndexer>();
        var mimeLogger = loggerFactory.CreateLogger<MimeTypeHelper>();

        logger.LogInformation("Building file index for: {Path}", path);

        try
        {
            var dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "index.db");
            
            using var database = new IndexDatabase(dbPath, dbLogger);
            var mimeTypeHelper = new MimeTypeHelper(mimeLogger);
            var indexer = new FileIndexer(database, indexerLogger, mimeTypeHelper, path, useRelativePaths: true);

            var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
                logger.LogInformation("Cancellation requested...");
            };

            await indexer.BuildInitialIndexAsync(cts.Token);
            
            logger.LogInformation("Index build completed successfully!");
        }
        catch (OperationCanceledException)
        {
            logger.LogWarning("Index build was cancelled");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error building index");
        }
    }

    private static async Task MonitorAsync(string path, ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Monitor");
        var dbLogger = loggerFactory.CreateLogger<IndexDatabase>();
        var indexerLogger = loggerFactory.CreateLogger<FileIndexer>();
        var monitorLogger = loggerFactory.CreateLogger<FileMonitor>();
        var mimeLogger = loggerFactory.CreateLogger<MimeTypeHelper>();

        logger.LogInformation("Starting file system monitoring for: {Path}", path);

        try
        {
            var dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "index.db");
            
            using var database = new IndexDatabase(dbPath, dbLogger);
            var mimeTypeHelper = new MimeTypeHelper(mimeLogger);
            var indexer = new FileIndexer(database, indexerLogger, mimeTypeHelper, path, useRelativePaths: true);
            using var monitor = new FileMonitor(indexer, monitorLogger);

            monitor.StartMonitoring(path);

            logger.LogInformation("File system monitoring started. Press Ctrl+C to stop...");
            
            var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
            };

            await Task.Delay(Timeout.Infinite, cts.Token);
        }
        catch (OperationCanceledException)
        {
            logger.LogInformation("Monitoring stopped");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error during monitoring");
        }
    }

    private static async Task FullIndexAsync(string path, ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("FullIndex");
        
        logger.LogInformation("Starting full indexing (build + monitor) for: {Path}", path);

        // First build the index
        await BuildIndexAsync(path, loggerFactory);

        // Then start monitoring
        await MonitorAsync(path, loggerFactory);
    }

    private static void SearchAsync(string term, int limit, ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Search");
        var dbLogger = loggerFactory.CreateLogger<IndexDatabase>();

        try
        {
            var dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "index.db");
            
            using var database = new IndexDatabase(dbPath, dbLogger);
            var results = database.SearchFiles(term, limit);

            Console.WriteLine($"Search results for '{term}':");
            Console.WriteLine(new string('-', 50));

            foreach (var result in results)
            {
                var sizeText = result.IsDirectory ? "[DIR]" : $"{result.Size:N0} bytes";
                Console.WriteLine($"{result.FileName}");
                Console.WriteLine($"  Path: {result.FullPath}");
                Console.WriteLine($"  Size: {sizeText}");
                Console.WriteLine($"  Type: {result.MimeType}");
                Console.WriteLine($"  Modified: {result.LastWriteTime:yyyy-MM-dd HH:mm:ss}");
                Console.WriteLine();
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error during search");
        }
    }

    private static void ShowStatusAsync(ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("Status");
        var dbLogger = loggerFactory.CreateLogger<IndexDatabase>();

        try
        {
            var dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "index.db");
            
            if (!File.Exists(dbPath))
            {
                Console.WriteLine("No index database found. Run 'build' command first.");
                return;
            }

            using var database = new IndexDatabase(dbPath, dbLogger);
            
            var totalFiles = database.GetTotalFileCount();
            var lastBuilt = database.GetMetadata("last_built");
            var baseDirectory = database.GetMetadata("base_directory");
            var useRelativePaths = database.GetMetadata("use_relative_paths");
            var dbVersion = database.GetMetadata("db_version");

            Console.WriteLine("NTFS Indexer Status");
            Console.WriteLine("==================");
            Console.WriteLine($"Database Path: {dbPath}");
            Console.WriteLine($"Database Version: {dbVersion ?? "Unknown"}");
            Console.WriteLine($"Total Files Indexed: {totalFiles:N0}");
            Console.WriteLine($"Base Directory: {baseDirectory ?? "Unknown"}");
            Console.WriteLine($"Use Relative Paths: {useRelativePaths ?? "Unknown"}");
            Console.WriteLine($"Last Full Index: {(lastBuilt != null ? DateTime.Parse(lastBuilt).ToString("yyyy-MM-dd HH:mm:ss") : "Never")}");
            Console.WriteLine($"Database Size: {new FileInfo(dbPath).Length / 1024.0 / 1024.0:F2} MB");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error showing status");
        }
    }
} 