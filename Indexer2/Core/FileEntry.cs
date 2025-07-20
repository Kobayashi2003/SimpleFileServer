namespace Indexer2.Core;

public class FileEntry
{
    public string FullPath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
    public string ParentPath { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime CreationTime { get; set; }
    public DateTime LastWriteTime { get; set; }
    public DateTime LastAccessTime { get; set; }
    public DateTime IndexedTime { get; set; }
    public bool IsDirectory { get; set; }
    public FileAttributes Attributes { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public ulong MftRecordNumber { get; set; } // MFT 记录号，用于快速定位
}
