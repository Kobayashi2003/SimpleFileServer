using Microsoft.Extensions.Logging;
using MimeKit;

namespace NtfsIndexer.Utils;

public class MimeTypeHelper
{
    private readonly ILogger<MimeTypeHelper> _logger;

    public MimeTypeHelper(ILogger<MimeTypeHelper> logger)
    {
        _logger = logger;
    }

    public string GetMimeType(string filePath)
    {
        try
        {
            // Use MimeKit to detect MIME type
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