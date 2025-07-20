using System.Collections.Concurrent;

namespace Indexer2.Core;

/// <summary>
/// 快速 MIME 类型检测器，基于扩展名映射
/// </summary>
public class FastMimeTypeDetector
{
    private readonly ConcurrentDictionary<string, string> _extensionMap;
    private readonly ConcurrentDictionary<string, string> _customCache;

    public FastMimeTypeDetector()
    {
        _extensionMap = new ConcurrentDictionary<string, string>(InitializeMimeTypeMap());
        _customCache = new ConcurrentDictionary<string, string>();
    }

    public string GetMimeType(string filePath, string extension = "")
    {
        if (string.IsNullOrEmpty(extension))
        {
            extension = Path.GetExtension(filePath).ToLowerInvariant();
        }
        else
        {
            extension = extension.ToLowerInvariant();
        }

        // 首先检查预定义映射
        if (_extensionMap.TryGetValue(extension, out var knownMimeType))
        {
            return knownMimeType;
        }

        // 检查自定义缓存
        if (_customCache.TryGetValue(extension, out var cachedMimeType))
        {
            return cachedMimeType;
        }

        // 对于未知扩展名，返回默认值
        var defaultMimeType = "application/octet-stream";
        _customCache.TryAdd(extension, defaultMimeType);
        return defaultMimeType;
    }

    private static Dictionary<string, string> InitializeMimeTypeMap()
    {
        return new Dictionary<string, string>
        {
            // 文本文件
            { "", "text/plain" },
            { ".txt", "text/plain" },
            { ".log", "text/plain" },
            { ".ini", "text/plain" },
            { ".cfg", "text/plain" },
            { ".conf", "text/plain" },
            { ".csv", "text/csv" },
            { ".xml", "text/xml" },
            { ".json", "application/json" },
            { ".html", "text/html" },
            { ".htm", "text/html" },
            { ".css", "text/css" },
            { ".js", "text/javascript" },
            { ".ts", "text/typescript" },
            { ".md", "text/markdown" },
            { ".yaml", "text/yaml" },
            { ".yml", "text/yaml" },
            { ".rtf", "application/rtf" },

            // 图片文件
            { ".jpg", "image/jpeg" },
            { ".jpeg", "image/jpeg" },
            { ".png", "image/png" },
            { ".gif", "image/gif" },
            { ".bmp", "image/bmp" },
            { ".webp", "image/webp" },
            { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" },
            { ".tiff", "image/tiff" },
            { ".tif", "image/tiff" },
            { ".psd", "image/vnd.adobe.photoshop" },
            { ".ai", "application/postscript" },
            { ".eps", "application/postscript" },
            { ".raw", "image/x-canon-cr2" },
            { ".cr2", "image/x-canon-cr2" },
            { ".nef", "image/x-nikon-nef" },
            { ".arw", "image/x-sony-arw" },

            // 音频文件
            { ".mp3", "audio/mpeg" },
            { ".wav", "audio/wav" },
            { ".flac", "audio/flac" },
            { ".aac", "audio/aac" },
            { ".ogg", "audio/ogg" },
            { ".wma", "audio/x-ms-wma" },
            { ".m4a", "audio/mp4" },
            { ".opus", "audio/opus" },
            { ".aiff", "audio/x-aiff" },
            { ".au", "audio/basic" },

            // 视频文件
            { ".mp4", "video/mp4" },
            { ".avi", "video/x-msvideo" },
            { ".mkv", "video/x-matroska" },
            { ".mov", "video/quicktime" },
            { ".wmv", "video/x-ms-wmv" },
            { ".flv", "video/x-flv" },
            { ".webm", "video/webm" },
            { ".m4v", "video/mp4" },
            { ".3gp", "video/3gpp" },
            { ".ogv", "video/ogg" },
            { ".ts", "video/mp2t" },
            { ".mts", "video/mp2t" },
            { ".m2ts", "video/mp2t" },

            // 文档文件
            { ".pdf", "application/pdf" },
            { ".doc", "application/msword" },
            { ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            { ".xls", "application/vnd.ms-excel" },
            { ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            { ".ppt", "application/vnd.ms-powerpoint" },
            { ".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
            { ".odt", "application/vnd.oasis.opendocument.text" },
            { ".ods", "application/vnd.oasis.opendocument.spreadsheet" },
            { ".odp", "application/vnd.oasis.opendocument.presentation" },

            // 电子书文件
            { ".epub", "application/epub+zip" },
            { ".mobi", "application/x-mobipocket-ebook" },
            { ".azw", "application/vnd.amazon.ebook" },
            { ".azw3", "application/vnd.amazon.ebook" },
            { ".fb2", "application/x-fictionbook+xml" },

            // 压缩文件
            { ".zip", "application/zip" },
            { ".rar", "application/vnd.rar" },
            { ".7z", "application/x-7z-compressed" },
            { ".tar", "application/x-tar" },
            { ".gz", "application/gzip" },
            { ".bz2", "application/x-bzip2" },
            { ".xz", "application/x-xz" },
            { ".iso", "application/x-iso9660-image" },

            // 程序文件
            { ".exe", "application/vnd.microsoft.portable-executable" },
            { ".dll", "application/vnd.microsoft.portable-executable" },
            { ".msi", "application/x-msi" },
            { ".deb", "application/vnd.debian.binary-package" },
            { ".rpm", "application/x-rpm" },
            { ".dmg", "application/x-apple-diskimage" },
            { ".pkg", "application/x-newton-compatible-pkg" },
            { ".appx", "application/appx" },

            // 开发文件
            { ".cs", "text/x-csharp" },
            { ".java", "text/x-java" },
            { ".py", "text/x-python" },
            { ".cpp", "text/x-c" },
            { ".c", "text/x-c" },
            { ".h", "text/x-c" },
            { ".hpp", "text/x-c" },
            { ".php", "text/x-php" },
            { ".rb", "text/x-ruby" },
            { ".go", "text/x-go" },
            { ".rs", "text/x-rust" },
            { ".swift", "text/x-swift" },
            { ".kt", "text/x-kotlin" },
            { ".scala", "text/x-scala" },
            { ".sh", "application/x-sh" },
            { ".bat", "application/x-msdos-program" },
            { ".cmd", "application/x-msdos-program" },
            { ".ps1", "application/x-powershell" },

            // 数据库文件
            { ".db", "application/x-sqlite3" },
            { ".sqlite", "application/x-sqlite3" },
            { ".sqlite3", "application/x-sqlite3" },
            { ".mdb", "application/vnd.ms-access" },
            { ".accdb", "application/vnd.ms-access" },

            // 字体文件
            { ".ttf", "font/ttf" },
            { ".otf", "font/otf" },
            { ".woff", "font/woff" },
            { ".woff2", "font/woff2" },
            { ".eot", "application/vnd.ms-fontobject" },

            // 3D 模型文件
            { ".obj", "text/plain" },
            { ".fbx", "application/octet-stream" },
            { ".dae", "model/vnd.collada+xml" },
            { ".3ds", "application/x-3ds" },
            { ".blend", "application/x-blender" },

            // CAD 文件
            { ".dwg", "application/acad" },
            { ".dxf", "application/dxf" },
            { ".step", "application/step" },
            { ".stp", "application/step" },
            { ".iges", "application/iges" },
            { ".igs", "application/iges" }
        };
    }

    public void AddCustomMapping(string extension, string mimeType)
    {
        extension = extension.ToLowerInvariant();
        if (!extension.StartsWith("."))
        {
            extension = "." + extension;
        }
        
        _extensionMap.TryAdd(extension, mimeType);
    }

    public IReadOnlyDictionary<string, string> GetAllMappings()
    {
        return _extensionMap.ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
    }
}
