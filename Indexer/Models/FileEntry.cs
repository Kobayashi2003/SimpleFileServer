namespace NtfsIndexer.Models;

public class FileEntry
{
    public long Id { get; set; }
    public string Path { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long Size { get; set; }
    public DateTime LastWriteTime { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }

    public override string ToString()
    {
        return $"{(IsDirectory ? "[DIR]" : "[FILE]")} {FileName} ({Size} bytes)";
    }
} 