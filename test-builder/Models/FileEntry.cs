namespace IndexBuilder.Models;

public class FileEntry
{
    public long Id { get; set; }
    public string FullPath { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime CreationTime { get; set; }
    public DateTime LastWriteTime { get; set; }
    public DateTime LastAccessTime { get; set; }
    public string? FileHash { get; set; }
    public bool IsDirectory { get; set; }
    public string? ParentPath { get; set; }
    public FileAttributes Attributes { get; set; }
} 