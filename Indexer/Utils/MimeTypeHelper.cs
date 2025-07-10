using Microsoft.Extensions.Logging;
using MimeKit;

namespace NtfsIndexer.Utils;

public class MimeTypeHelper
{
    private readonly ILogger<MimeTypeHelper> _logger;

    private static readonly Dictionary<string, string> PriorityMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        { ".psd", "image/vnd.adobe.photoshop" },
        { ".cbr", "application/cbr" },
        { ".cbz", "application/cbz" },
    };

    public MimeTypeHelper(ILogger<MimeTypeHelper> logger)
    {
        _logger = logger;
    }

    public string GetMimeType(string filePath)
    {
        try
        {
            var extension = Path.GetExtension(filePath);
            
            if (!string.IsNullOrEmpty(extension) && PriorityMimeTypes.TryGetValue(extension, out var priorityMimeType))
            {
                _logger.LogDebug("Found priority MIME type for {FilePath} (extension: {Extension}): {MimeType}", 
                    filePath, extension, priorityMimeType);
                return priorityMimeType;
            }

            var mimeType = MimeTypes.GetMimeType(filePath);
            
            _logger.LogDebug("Detected MIME type for {FilePath}: {MimeType}", filePath, mimeType);
            return mimeType;
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
}