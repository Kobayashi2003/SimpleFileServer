// Configuration for the file server
// You can customize the base directory to serve files from
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.NO_CONFIG_WARNING = 'true';
process.env.SUPPRESS_NO_CONFIG_WARNING = 'true';

const BASE_DIR = process.env.BASE_DIRECTORY || 'D:/Temp';
const TMP_DIR = path.join(os.tmpdir(), 'simple-file-server');

const config = {

  port: process.env.PORT || 11073,

  baseDirectory: BASE_DIR,
  tempDirectory: TMP_DIR,
  logsDirectory: process.env.LOG_DIRECTORY || 'logs',

  // Background image path - can be absolute or relative to server root
  backgroundImagePath: process.env.BACKGROUND_IMAGE_PATH || path.join(__dirname, 'bg.jpg'),
  // Background images folder - can be absolute or relative to server root
  backgroundImagesDir: process.env.BACKGROUND_IMAGES_DIR || path.join(__dirname, 'backgrounds'),

  uploadCountLimit: process.env.UPLOAD_COUNT_LIMIT || 10,
  uploadSizeLimit: process.env.UPLOAD_SIZE_LIMIT || 1024 * 1024 * 100, // 100MB

  contentMaxSize: process.env.CONTENT_MAX_SIZE || 5 * 1024 * 1024 * 1024, // 5GB

  generateThumbnail: process.env.GENERATE_THUMBNAIL === 'true' || false,
  thumbnailCacheDir: process.env.THUMBNAIL_CACHE_DIR || path.join(TMP_DIR, 'thumbnails'),
  generateThumbnailForGif: process.env.GENERATE_THUMBNAIL_FOR_GIF === 'true' || false,
  
  // PSD processing options
  // NOTE: This may cause a large storage usage, please be careful.
  processPsd: process.env.PROCESS_PSD === 'true' || false,
  psdCacheDir: process.env.PSD_CACHE_DIR || path.join(TMP_DIR, 'processed-psd'),
  psdProcessor: process.env.PSD_PROCESSOR || 'psd', // 'psd' or 'imagemagick'
  
  // User authentication settings
  // Format: 'username|password|rw' where 'rw' indicates read and write permissions
  // Examples: 'admin|admin123|rw' (full access), 'guest|guest123|r' (read-only access)
  // If empty array, authentication is disabled
  userRules: process.env.USER_RULES ? 
    process.env.USER_RULES.split(',').map(rule => rule.trim())
  : [
    'admin|admin123|rw',
    'guest|guest123|r'
  ],
  
  // File indexing options
  useFileIndex: process.env.USE_FILE_INDEX === 'true' || false,
  fileIndexPath: process.env.FILE_INDEX_PATH || path.join(TMP_DIR, 
    crypto.createHash('sha256').update(BASE_DIR.endsWith('/') ? BASE_DIR.slice(0, -1) : BASE_DIR).digest('hex') + '.db'
  ),
  rebuildIndexOnStartup: process.env.REBUILD_INDEX_ON_STARTUP === 'true' || false,
  countFilesBatchSize: parseInt(process.env.COUNT_FILES_BATCH_SIZE) || 100,
  indexBatchSize: parseInt(process.env.INDEX_BATCH_SIZE) || 100,
  indexerSearchAlgorithm: process.env.INDEXER_SEARCH_ALGORITHM || 'bfs', // 'dfs' or 'bfs'
  indexerConcurrencyEnabled: process.env.INDEXER_CONCURRENCY_ENABLED !== 'false', // default true
  indexerConcurrencyLimit: parseInt(process.env.INDEXER_CONCURRENCY_LIMIT) || 100,
  indexerStorageMode: process.env.INDEXER_STORAGE_MODE || 'batch', // 'batch' or 'immediate'
  // Adaptive worker count based on system memory (0 = auto, or specify exact count)
  indexerWorkerCount: parseInt(process.env.INDEXER_WORKER_COUNT) || 0,
  
  // File watcher options
  useFileWatcher: process.env.USE_FILE_WATCHER === 'true' || false,
  // useFileWatcher: true,
  // Watch depth: 0 = only base directory, 1 = base + one level, etc., -1 = all subdirectories (may impact performance)
  watchDepth: parseInt(process.env.WATCH_DEPTH) || 1, 
  // Ignore patterns (glob patterns) for files/directories to ignore during watching
  watchIgnorePatterns: (process.env.WATCH_IGNORE_PATTERNS || '**/.git/**,**/node_modules/**,**/__pycache__/**').split(','),
  // Debounce interval in ms for file change events
  watchDebounceInterval: parseInt(process.env.WATCH_DEBOUNCE_INTERVAL) || 1000,
  // Maximum number of retries for failed watcher operations
  watchMaxRetries: parseInt(process.env.WATCH_MAX_RETRIES) || 3,
  // Delay in ms before retrying a failed watcher operation
  watchRetryDelay: parseInt(process.env.WATCH_RETRY_DELAY) || 10000, // 10 seconds
  
  // File processing mode (parallel/sync)
  parallelFileProcessing: process.env.PARALLEL_FILE_PROCESSING !== 'false', // default true

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

}

const originalStdoutWrite = process.stdout.write;
process.stdout.write = (chunk, encoding, callback) => {
  const date = new Date().toISOString();
  return originalStdoutWrite.call(process.stdout, `[${date}] ${chunk}`, encoding, callback);
};

const originalStderrWrite = process.stderr.write;
process.stderr.write = (chunk, encoding, callback) => {
  const date = new Date().toISOString();
  return originalStderrWrite.call(process.stderr, `[${date}] ${chunk}`, encoding, callback);
};

process
  .on('uncaughtException', (error, origin) => {
    const errorTime = new Date().toISOString();
    const errorLog = `
    ====== Uncaught Exception at ${errorTime} ======
    Origin: ${origin}
    Error: ${error}
    Stack: ${error.stack}
    ================================================
    `;

    fs.appendFileSync(path.join(config.logsDirectory, 'crash.log'), errorLog);
    console.error(`[${errorTime}] Uncaught Exception:`, error);
    // exit if the error is not recoverable
    if (!utils.isRecoverableError(error)) {
      process.exit(1);
    }
  })
  .on('unhandledRejection', (reason, promise) => {
    const errorTime = new Date().toISOString();
    const errorLog = `
    ====== Unhandled Rejection at ${errorTime} ======
    Promise: ${promise}
    Reason: ${reason}
    ${reason.stack ? `Stack: ${reason.stack}` : ''}
    ================================================
    `;

    fs.appendFileSync(path.join(config.logsDirectory, 'rejections.log'), errorLog);
    console.error(`[${errorTime}] Unhandled Rejection:`, reason);
  });


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



module.exports = config;