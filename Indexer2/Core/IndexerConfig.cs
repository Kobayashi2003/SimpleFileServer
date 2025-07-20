namespace Indexer2.Core;

public class IndexerConfig
{
    public string BaseDirectory { get; set; } = string.Empty;
    public string OutputDatabasePath { get; set; } = "index.db";
    public bool ForceRebuild { get; set; } = false;
    public bool EnableMonitoring { get; set; } = false;
    public bool UseRelativePaths { get; set; } = true;
    public bool VerboseLogging { get; set; } = false;
    public int BatchSize { get; set; } = 10000;
    public int MaxConcurrency { get; set; } = Environment.ProcessorCount * 2;
}
