using Microsoft.Extensions.Logging;
using Indexer2.Core;
using Indexer2.Services;
using System.CommandLine;

namespace Indexer2;

class Program
{
    static async Task<int> Main(string[] args)
    {
        // 设置日志记录
        using var loggerFactory = LoggerFactory.Create(builder =>
            builder.AddConsole().SetMinimumLevel(LogLevel.Information));
        
        var logger = loggerFactory.CreateLogger<Program>();

        try
        {
            var rootCommand = new RootCommand("Indexer2 - High-performance file indexer using Everything-like strategies");

            // 基本参数
            var baseDirectoryOption = new Option<string>(
                "--base-directory",
                description: "Base directory to index (required)",
                getDefaultValue: () => string.Empty);
            baseDirectoryOption.IsRequired = true;

            var outputOption = new Option<string>(
                "--output",
                description: "Output database file path",
                getDefaultValue: () => "index.db");

            var forceOption = new Option<bool>(
                "--force",
                description: "Force rebuild index even if exists");

            var monitorOption = new Option<bool>(
                "--monitor",
                description: "Enable real-time monitoring after initial build");

            var useRelativePathsOption = new Option<bool>(
                "--relative-paths",
                description: "Use relative paths in index",
                getDefaultValue: () => true);

            var verboseOption = new Option<bool>(
                "--verbose",
                description: "Enable verbose logging");

            // 添加选项到命令
            rootCommand.AddOption(baseDirectoryOption);
            rootCommand.AddOption(outputOption);
            rootCommand.AddOption(forceOption);
            rootCommand.AddOption(monitorOption);
            rootCommand.AddOption(useRelativePathsOption);
            rootCommand.AddOption(verboseOption);

            rootCommand.SetHandler(async (baseDirectory, output, force, monitor, useRelativePaths, verbose) =>
            {
                if (verbose)
                {
                    loggerFactory.CreateLogger<Program>().LogInformation("Verbose logging enabled");
                }

                var config = new IndexerConfig
                {
                    BaseDirectory = baseDirectory,
                    OutputDatabasePath = output,
                    ForceRebuild = force,
                    EnableMonitoring = monitor,
                    UseRelativePaths = useRelativePaths,
                    VerboseLogging = verbose
                };

                var indexer = new FastFileIndexer(config, loggerFactory);
                await indexer.RunAsync();

            }, baseDirectoryOption, outputOption, forceOption, monitorOption, useRelativePathsOption, verboseOption);

            return await rootCommand.InvokeAsync(args);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Fatal error occurred");
            return 1;
        }
    }
}
