// Configuration for the file server
// You can customize the base directory to serve files from
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.NO_CONFIG_WARNING = 'true';
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

const BASE_DIR = process.env.BASE_DIRECTORY || 'example';
const TMP_DIR = path.join(os.tmpdir(), 'simple-file-server');

const config = {

  // Server port number
  port: process.env.PORT || 11073,

  // Base directory for file operations
  baseDirectory: BASE_DIR,
  // Temporary directory for cache and temporary files
  tempDirectory: TMP_DIR,

  // File processing mode (parallel/sync)
  // Enable parallel file processing for better performance when file indexing is disabled
  parallelFileProcessing: process.env.PARALLEL_FILE_PROCESSING !== 'false', // default true

  // Maximum number of files that can be uploaded in a single request
  uploadCountLimit: process.env.UPLOAD_COUNT_LIMIT || 10,
  // Maximum size limit for file uploads (default: 100GB)
  uploadSizeLimit: process.env.UPLOAD_SIZE_LIMIT || 1024 * 1024 * 1024 * 100, // 100GB
  // Maximum file size for content display (default: 5GB)
  contentMaxSize: process.env.CONTENT_MAX_SIZE || 5 * 1024 * 1024 * 1024, // 5GB



  // *** Logging options
  // **************************************************
  // Directory for storing log files
  logsDirectory: process.env.LOG_DIRECTORY || 'logs',
  // Enable console output with timestamps
  enableConsoleTimestamps: process.env.ENABLE_CONSOLE_TIMESTAMPS !== 'false', // Default: true
  // Enable error logging to files
  enableErrorLogging: process.env.ENABLE_ERROR_LOGGING !== 'false', // Default: true
  // Enable API logging
  enableApiLogging: process.env.ENABLE_API_LOGGING !== 'false', // Default: true
  // Enable file logging (save logs to files)
  enableFileLogging: process.env.ENABLE_FILE_LOGGING === 'true' || false,
  // API log level: 'basic', 'detailed', 'verbose'
  apiLogLevel: process.env.API_LOG_LEVEL || 'detailed',
  // Whether to log request body (for sensitive operations, set to false)
  logRequestBody: process.env.LOG_REQUEST_BODY !== 'false', // Default: true
  // Whether to log response body (for large responses, set to false)
  logResponseBody: process.env.LOG_RESPONSE_BODY === 'false', // Default: false
  // Log file rotation: 'daily', 'weekly', 'monthly', 'none' (default: daily)
  logFileRotation: process.env.LOG_FILE_ROTATION || 'daily',
  // Maximum log file size in MB before rotation (default: 10MB)
  maxLogFileSize: parseInt(process.env.MAX_LOG_FILE_SIZE) || 10,
  // Number of log files to keep (default: 7)
  logFilesToKeep: parseInt(process.env.LOG_FILES_TO_KEEP) || 7,



  // *** Image related options
  // **************************************************
  // Background image path - can be absolute or relative to server root
  backgroundImagePath: process.env.BACKGROUND_IMAGE_PATH || path.join(__dirname, 'bg.jpg'),
  // Background images folder - can be absolute or relative to server root
  backgroundImagesDir: process.env.BACKGROUND_IMAGES_DIR || path.join(__dirname, 'backgrounds'),
  // Enable thumbnail generation for images and videos
  generateThumbnail: process.env.GENERATE_THUMBNAIL === 'true' || false,
  // Directory for storing generated thumbnails
  thumbnailCacheDir: process.env.THUMBNAIL_CACHE_DIR || path.join(TMP_DIR, 'thumbnails'),
  // Enable thumbnail generation for GIF files (may impact performance)
  generateThumbnailForGif: process.env.GENERATE_THUMBNAIL_FOR_GIF === 'true' || false,
  // PSD processing options
  // NOTE: This may cause a large storage usage, please be careful.
  // Enable PSD file processing to convert to viewable format
  processPsd: process.env.PROCESS_PSD === 'true' || false,
  // Directory for storing processed PSD files
  psdCacheDir: process.env.PSD_CACHE_DIR || path.join(TMP_DIR, 'processed-psd'),
  // PSD processing method: 'psd' (JavaScript library) or 'imagemagick' (system command)
  psdProcessor: process.env.PSD_PROCESSOR || 'psd', // 'psd' or 'imagemagick'



  // *** User authentication settings
  // **************************************************
  // Format: 'username|password|rw' where 'rw' indicates read and write permissions
  // Examples: 'admin|admin123|rw' (full access), 'guest|guest123|r' (read-only access)
  // If empty array, authentication is disabled
  userRules: process.env.USER_RULES ?
    process.env.USER_RULES.split(',').map(rule => rule.trim())
    : [
      // 'admin|admin123|rw',
      // 'guest|guest123|r'
    ],



  // *** File indexing common options
  // **************************************************
  // Path to the SQLite database file for storing file index
  fileIndexPath: process.env.FILE_INDEX_PATH || path.join(TMP_DIR,
    crypto.createHash('sha256').update(BASE_DIR.endsWith('/') ? BASE_DIR.slice(0, -1) : BASE_DIR).digest('hex') + '.db'
  ),
  // Whether to use file index for /api/files endpoint (requires useFileIndex to be true)
  useFileIndexForFilesApi: process.env.USE_FILE_INDEX_FOR_FILES_API === 'true' || false,



  // *** File Node.js Indexing options 
  // **************************************************
  // Enable file indexing for faster search and browsing
  useFileIndex: process.env.USE_FILE_INDEX === 'true' || false,
  // Whether to update index during write operations (upload, delete, rename, move, clone, mkdir)
  updateIndexOnWrite: process.env.UPDATE_INDEX_ON_WRITE === 'true' || false,
  // Rebuild file index on server startup
  rebuildIndexOnStartup: process.env.REBUILD_INDEX_ON_STARTUP === 'true' || false,
  // Number of files to process in a batch when counting files
  countFilesBatchSize: parseInt(process.env.COUNT_FILES_BATCH_SIZE) || 100,
  // Number of files to process in a batch when building index
  indexBatchSize: parseInt(process.env.INDEX_BATCH_SIZE) || 100,
  // Search algorithm for indexer: 'bfs' (breadth-first) or 'dfs' (depth-first)
  indexerSearchAlgorithm: process.env.INDEXER_SEARCH_ALGORITHM || 'bfs', // 'dfs' or 'bfs'
  // Enable concurrent file processing during indexing
  indexerConcurrencyEnabled: process.env.INDEXER_CONCURRENCY_ENABLED !== 'false', // default true
  // Maximum number of concurrent file operations during indexing
  indexerConcurrencyLimit: parseInt(process.env.INDEXER_CONCURRENCY_LIMIT) || 100,
  // Storage mode for indexer: 'batch' (save in batches) or 'immediate' (save immediately)
  indexerStorageMode: process.env.INDEXER_STORAGE_MODE || 'batch', // 'batch' or 'immediate'
  // Adaptive worker count based on system memory (0 = auto, or specify exact count)
  indexerWorkerCount: parseInt(process.env.INDEXER_WORKER_COUNT) || 0,



  // *** File watcher options
  // **************************************************
  // Enable real-time file system monitoring (ignored if useCSharpIndexer is true)
  useFileWatcher: process.env.USE_FILE_WATCHER === 'true' || false,
  // useFileWatcher: true,
  // Watch depth: 0 = only base directory, 1 = base + one level, etc., -1 = all subdirectories (may impact performance)
  watchDepth: parseInt(process.env.WATCH_DEPTH) || 1,
  // Ignore patterns (glob patterns) for files/directories to ignore during watching
  watchIgnorePatterns: (process.env.WATCH_IGNORE_PATTERNS || '**/.git/**,**/node_modules/**,**/__pycache__/**').split(','),
  // Debounce interval in ms for file change events (prevents excessive updates)
  watchDebounceInterval: parseInt(process.env.WATCH_DEBOUNCE_INTERVAL) || 1000,
  // Maximum number of retries for failed watcher operations
  watchMaxRetries: parseInt(process.env.WATCH_MAX_RETRIES) || 3,
  // Delay in ms before retrying a failed watcher operation
  watchRetryDelay: parseInt(process.env.WATCH_RETRY_DELAY) || 10000, // 10 seconds



  // *** C# Indexer Integration
  // **************************************************
  // Use C# indexer instead of Node.js indexer and watcher (takes over both indexing and file watching)
  useCSharpIndexer: process.env.USE_CSHARP_INDEXER === 'true' || false,
  // Path to the C# indexer executable
  cSharpIndexerPath: process.env.CSHARP_INDEXER_PATH || path.join(__dirname, '../Indexer/bin/Release/net8.0/NtfsIndexer.exe'),
  // Whether to force rebuild the C# index on startup
  // true: Always delete existing database and rebuild from scratch
  // false: Reuse existing index if available, only build if no index exists
  cSharpIndexerForceRebuild: process.env.CSHARP_INDEXER_FORCE_REBUILD === 'true' || false,
  // Whether to automatically restart C# indexer if it crashes
  cSharpIndexerAutoRestart: process.env.CSHARP_INDEXER_AUTO_RESTART !== 'false', // default true
  // Maximum number of restart attempts
  cSharpIndexerMaxRestarts: parseInt(process.env.CSHARP_INDEXER_MAX_RESTARTS) || 3,
  // Restart delay in seconds
  cSharpIndexerRestartDelay: parseInt(process.env.CSHARP_INDEXER_RESTART_DELAY) || 5,



  // *** File type detection options
  // **************************************************
  // Use mime-magic to detect file type
  // If you want to support more file types, you can set it to true, but it may impact performance
  useMimeMagic: process.env.USE_MIME_MAGIC === 'true' || false,
  // Custom content types (key-value pairs)
  // This is used when useMimeMagic is false or when mime-magic fails to detect the file type
  // If you want to support more file types, but don't want to use mime-magic, you can set more content types here
  customContentTypes: process.env.CUSTOM_CONTENT_TYPES
    ? JSON.parse(process.env.CUSTOM_CONTENT_TYPES)
    : {
      // '.myext': 'application/my-custom-type',
    },



  // *** Recycle Bin options
  // **************************************************
  // Enable recycle bin functionality (move files to recycle bin instead of permanent deletion)
  // When enabled, files are moved to the recycle bin directory instead of being permanently deleted
  // You can enable this feature by setting the environment variable USE_RECYCLE_BIN=true
  useRecycleBin: process.env.USE_RECYCLE_BIN === 'true' || false,
  
  // Directory for storing deleted files (recycle bin)
  // This directory will store all files that are "deleted" when recycle bin is enabled
  // Each file/folder is stored with a timestamp prefix to avoid name collisions
  // A metadata file (.meta.json) is created alongside each item to track its original path and deletion time
  recycleBinDirectory: process.env.RECYCLE_BIN_DIRECTORY || path.join(TMP_DIR, 'recycle-bin'),
  
  // Maximum number of days to keep files in recycle bin (0 = keep forever)
  // Files older than this will be permanently deleted during automatic cleanup
  // Set to 0 to keep files in recycle bin indefinitely (manual cleanup only)
  recycleBinRetentionDays: parseInt(process.env.RECYCLE_BIN_RETENTION_DAYS) || 30,
  
  // Enable automatic cleanup of old files in recycle bin based on retention days
  // When enabled, files older than recycleBinRetentionDays will be permanently deleted
  // Cleanup runs on server startup and once per day afterward
  recycleBinAutoCleanup: process.env.RECYCLE_BIN_AUTO_CLEANUP !== 'false', // default true
  
  // Maximum size of recycle bin in MB (0 = no limit)
  // When the recycle bin exceeds this size, oldest files are deleted first
  // This helps prevent the recycle bin from consuming too much disk space
  // Set to 0 to disable size-based cleanup
  recycleBinMaxSize: parseInt(process.env.RECYCLE_BIN_MAX_SIZE) || 0,

}

if (!fs.existsSync(config.baseDirectory)) {
  fs.mkdirSync(config.baseDirectory, { recursive: true });
}

if (!fs.existsSync(config.tempDirectory)) {
  fs.mkdirSync(config.tempDirectory, { recursive: true });
}

if (!fs.existsSync(config.logsDirectory)) {
  fs.mkdirSync(config.logsDirectory, { recursive: true });
}

if (config.generateThumbnail && !fs.existsSync(config.thumbnailCacheDir)) {
  fs.mkdirSync(config.thumbnailCacheDir, { recursive: true });
}

if (config.processPsd && !fs.existsSync(config.psdCacheDir)) {
  fs.mkdirSync(config.psdCacheDir, { recursive: true });
}

if (config.useRecycleBin && !fs.existsSync(config.recycleBinDirectory)) {
  fs.mkdirSync(config.recycleBinDirectory, { recursive: true });
}

module.exports = config;