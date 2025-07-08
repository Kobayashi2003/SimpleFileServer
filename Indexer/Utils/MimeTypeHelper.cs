using Microsoft.Extensions.Logging;

namespace NtfsIndexer.Utils;

public class MimeTypeHelper
{
    private readonly ILogger<MimeTypeHelper> _logger;
    private readonly Dictionary<string, string> _mimeTypes;

    public MimeTypeHelper(ILogger<MimeTypeHelper> logger)
    {
        _logger = logger;
        _mimeTypes = InitializeMimeTypes();
    }

    public string GetMimeType(string filePath)
    {
        try
        {
            var extension = Path.GetExtension(filePath).ToLowerInvariant();
            
            if (_mimeTypes.TryGetValue(extension, out string? mimeType))
            {
                return mimeType;
            }

            // Default to application/octet-stream for unknown extensions
            return "application/octet-stream";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error determining MIME type for file: {FilePath}", filePath);
            return "application/octet-stream";
        }
    }

    public async Task<string> GetMimeTypeAsync(string filePath, CancellationToken cancellationToken = default)
    {
        return await Task.FromResult(GetMimeType(filePath));
    }

    private Dictionary<string, string> InitializeMimeTypes()
    {
        return new Dictionary<string, string>
        {
            // Text
            [".txt"] = "text/plain",
            [".md"] = "text/markdown",
            [".json"] = "application/json",
            [".xml"] = "application/xml",
            [".html"] = "text/html",
            [".htm"] = "text/html",
            [".css"] = "text/css",
            [".js"] = "application/javascript",
            [".ts"] = "application/typescript",
            [".csv"] = "text/csv",
            [".log"] = "text/plain",

            // Images
            [".png"] = "image/png",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".gif"] = "image/gif",
            [".bmp"] = "image/bmp",
            [".webp"] = "image/webp",
            [".svg"] = "image/svg+xml",
            [".ico"] = "image/x-icon",
            [".tiff"] = "image/tiff",
            [".tif"] = "image/tiff",
            [".psd"] = "image/vnd.adobe.photoshop",
            [".raw"] = "image/x-canon-cr2",
            [".cr2"] = "image/x-canon-cr2",
            [".nef"] = "image/x-nikon-nef",

            // Video
            [".mp4"] = "video/mp4",
            [".avi"] = "video/x-msvideo",
            [".mov"] = "video/quicktime",
            [".wmv"] = "video/x-ms-wmv",
            [".flv"] = "video/x-flv",
            [".webm"] = "video/webm",
            [".mkv"] = "video/x-matroska",
            [".m4v"] = "video/x-m4v",
            [".3gp"] = "video/3gpp",
            [".ts"] = "video/mp2t",

            // Audio
            [".mp3"] = "audio/mpeg",
            [".wav"] = "audio/wav",
            [".flac"] = "audio/flac",
            [".aac"] = "audio/aac",
            [".ogg"] = "audio/ogg",
            [".wma"] = "audio/x-ms-wma",
            [".m4a"] = "audio/x-m4a",
            [".opus"] = "audio/opus",

            // Documents
            [".pdf"] = "application/pdf",
            [".doc"] = "application/msword",
            [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xls"] = "application/vnd.ms-excel",
            [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".ppt"] = "application/vnd.ms-powerpoint",
            [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            [".odt"] = "application/vnd.oasis.opendocument.text",
            [".ods"] = "application/vnd.oasis.opendocument.spreadsheet",
            [".odp"] = "application/vnd.oasis.opendocument.presentation",
            [".rtf"] = "application/rtf",

            // Archives
            [".zip"] = "application/zip",
            [".rar"] = "application/vnd.rar",
            [".7z"] = "application/x-7z-compressed",
            [".tar"] = "application/x-tar",
            [".gz"] = "application/gzip",
            [".bz2"] = "application/x-bzip2",
            [".xz"] = "application/x-xz",

            // Executables
            [".exe"] = "application/x-msdownload",
            [".msi"] = "application/x-msdownload",
            [".dll"] = "application/x-msdownload",
            [".deb"] = "application/vnd.debian.binary-package",
            [".rpm"] = "application/x-rpm",
            [".dmg"] = "application/x-apple-diskimage",
            [".pkg"] = "application/x-newton-compatible-pkg",
            [".appx"] = "application/appx",

            // Comics/Books
            [".cbz"] = "application/x-cbz",
            [".cbr"] = "application/x-cbr",
            [".epub"] = "application/epub+zip",
            [".mobi"] = "application/x-mobipocket-ebook",
            [".azw"] = "application/vnd.amazon.ebook",
            [".azw3"] = "application/vnd.amazon.ebook",

            // Fonts
            [".ttf"] = "font/ttf",
            [".otf"] = "font/otf",
            [".woff"] = "font/woff",
            [".woff2"] = "font/woff2",
            [".eot"] = "application/vnd.ms-fontobject",

            // 3D/CAD
            [".stl"] = "model/stl",
            [".obj"] = "model/obj",
            [".fbx"] = "model/fbx",
            [".dae"] = "model/vnd.collada+xml",
            [".3ds"] = "model/3ds",
            [".blend"] = "application/x-blender",
            [".dwg"] = "image/vnd.dwg",
            [".dxf"] = "image/vnd.dxf",

            // Development
            [".c"] = "text/x-c",
            [".cpp"] = "text/x-c++",
            [".cs"] = "text/x-csharp",
            [".java"] = "text/x-java-source",
            [".py"] = "text/x-python",
            [".rb"] = "text/x-ruby",
            [".php"] = "text/x-php",
            [".go"] = "text/x-go",
            [".rs"] = "text/x-rust",
            [".swift"] = "text/x-swift",
            [".kt"] = "text/x-kotlin",
            [".sh"] = "application/x-sh",
            [".bat"] = "application/x-msdos-program",
            [".ps1"] = "application/x-powershell",
            [".sql"] = "application/sql",
            [".dockerfile"] = "text/x-dockerfile",
            [".yaml"] = "application/x-yaml",
            [".yml"] = "application/x-yaml",
            [".toml"] = "application/toml",
            [".ini"] = "text/plain",
            [".cfg"] = "text/plain",
            [".conf"] = "text/plain",

            // Virtual Machine
            [".vmdk"] = "application/x-vmdk",
            [".vdi"] = "application/x-vdi",
            [".vhd"] = "application/x-vhd",
            [".vhdx"] = "application/x-vhdx",
            [".ova"] = "application/x-ova",
            [".ovf"] = "application/x-ovf",

            // ISO/Disk Images
            [".iso"] = "application/x-iso9660-image",
            [".img"] = "application/x-disk-image",
            [".bin"] = "application/octet-stream",
            [".cue"] = "application/x-cue",
            [".nrg"] = "application/x-nrg",
            [".mdf"] = "application/x-mdf",
            [".mds"] = "application/x-mds"
        };
    }
} 