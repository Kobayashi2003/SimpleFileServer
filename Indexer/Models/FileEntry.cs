namespace NtfsIndexer.Models;

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
    public string MimeType { get; set; } = string.Empty;
    public string? FileHash { get; set; }
    public bool IsDirectory { get; set; }
    public string? ParentPath { get; set; }
    public FileAttributes Attributes { get; set; }
    public DateTime IndexedTime { get; set; }

    public override string ToString()
    {
        return $"{(IsDirectory ? "[DIR]" : "[FILE]")} {FileName} ({Size} bytes)";
    }
} 