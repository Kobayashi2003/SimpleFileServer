const config = require('./config')
const express = require('express');
const os = require('os');
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const cookieParser = require('cookie-parser');
const utils = require('./utils');
// handle zip and rar files
const AdmZip = require('adm-zip')
const unrar = require('node-unrar-js');
// handle file uploads
const multer = require('multer')
// indexer
const indexer = require('./indexer');
// watcher
const watcher = require('./watcher');
// C# indexer manager
const csharpIndexer = require('./csharp-indexer');
// auth
const { authMiddleware, writePermissionMiddleware, createSession, getSession, deleteSession } = require('./auth');
// logger
const { apiLoggingMiddleware } = require('./logger');
// worker threads
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
// For PSD file processing
const { execSync } = require('child_process');
const crypto = require('crypto');
const PSD = require('psd');
// limit the concurrency of file read
const pLimit = require('p-limit').default;
const fileReadLimit = pLimit(100);

const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use(apiLoggingMiddleware);

app.get('/api/version', (req, res) => {
  res.json({
    version: '1.0.0',
    username: req.user?.username,
    permissions: req.user?.permissions || 'none'
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  // Import validateUser from auth.js
  const { validateUser } = require('./auth');
  
  const userStatus = validateUser(username, password);
  
  if (!userStatus.isAuthenticated) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Create session and set cookie
  const sessionId = createSession(userStatus.username, userStatus.permissions);
  
  // Set HTTP-only cookie
  res.cookie('sessionId', sessionId, {
    httpOnly: true,        // prevent XSS attacks
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict',    // prevent CSRF attacks
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });
  
  res.json({
    success: true,
    username: userStatus.username,
    permissions: userStatus.permissions
  });
});

app.post('/api/logout', (req, res) => {
  // Delete session if exists
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    deleteSession(sessionId);
  }
  
  // Clear cookie
  res.clearCookie('sessionId');
  
  res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/validate-session', (req, res) => {
  // If userRules is not configured, authentication is disabled
  if (!config.userRules || config.userRules.length === 0) {
    return res.json({
      isAuthenticated: true,
      username: null,
      permissions: 'rw'
    });
  }

  // Check session cookie first
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return res.json({
        isAuthenticated: true,
        username: session.username,
        permissions: session.permissions
      });
    }
  }

  // Check Basic Auth if no valid session
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const base64Credentials = authHeader.split(' ')[1];
      const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');
      const [username, password] = credentials.split(':');
      
      const userStatus = validateUser(username, password);
      if (userStatus.isAuthenticated) {
        return res.json({
          isAuthenticated: true,
          username: userStatus.username,
          permissions: userStatus.permissions
        });
      }
    } catch (error) {
      // Invalid auth header, continue to return unauthenticated
    }
  }

  // Return unauthenticated status without triggering browser auth popup
  return res.json({
    isAuthenticated: false,
    username: null,
    permissions: null
  });
});

app.get('/api/bg', (req, res) => {
  try {
    // Get the background image path from config
    const bgImagePath = config.backgroundImagePath;

    // Check if file exists
    if (!fs.existsSync(bgImagePath)) {
      console.error(`Background image not found at path: ${bgImagePath}`);
      return res.status(404).send('Background image not found');
    }

    // Determine content type based on file extension
    const ext = path.extname(bgImagePath).toLowerCase();
    const contentType = utils.getFileTypeByExt(ext);

    if (!contentType.startsWith('image/')) {
      console.error(`Unsupported file extension: ${ext}`);
      return res.status(400).send('Unsupported file extension');
    }

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours

    // Stream the file to response
    const stream = fs.createReadStream(bgImagePath);
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving background image:', error);
    res.status(500).send('Error serving background image');
  }
})

app.get('/api/bgs', async (req, res) => {
  const { width, height } = req.query;
  const bgDir = path.resolve(config.backgroundImagesDir);

  try {
    // Check if the background images directory exists
    if (!fs.existsSync(bgDir)) {
      fs.mkdirSync(bgDir, { recursive: true });
      return res.status(404).json({ error: "No background images found" });
    }

    // Get all files in the background images directory
    const files = fs.readdirSync(bgDir).filter(file => {
      const filePath = path.join(bgDir, file);
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) return false;

      // Check if it's an image file
      const ext = path.extname(file).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
    });

    if (files.length === 0) {
      return res.status(404).json({ error: "No background images found" });
    }

    let selectedImage;

    // If both width and height are provided, find the most suitable image
    if (width && height) {
      const targetRatio = parseFloat(width) / parseFloat(height);

      // Get dimensions of all images (this could be optimized by caching)
      const images = [];

      for (const file of files) {
        try {
          const filePath = path.join(bgDir, file);
          // We'll use Sharp to get image dimensions if available
          const sharp = require('sharp');
          const metadata = await sharp(filePath).metadata();

          images.push({
            path: filePath,
            filename: file,
            width: metadata.width,
            height: metadata.height,
            ratio: metadata.width / metadata.height
          });
        } catch (error) {
          console.error(`Error processing background image ${file}:`, error);
          // Skip this file if there's an error
        }
      }

      if (images.length === 0) {
        // Fallback to random if no images could be processed
        selectedImage = path.join(bgDir, files[Math.floor(Math.random() * files.length)]);
      } else {
        // Find the image with the closest aspect ratio
        images.sort((a, b) => {
          return Math.abs(a.ratio - targetRatio) - Math.abs(b.ratio - targetRatio);
        });

        selectedImage = images[0].path;
      }
    } else {
      // If width and height are not provided, select a random image
      selectedImage = path.join(bgDir, files[Math.floor(Math.random() * files.length)]);
    }

    // Serve the selected image
    const ext = path.extname(selectedImage).toLowerCase();
    const contentType = utils.getFileTypeByExt(ext);

    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: "Selected file is not an image" });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

    // Stream the file to response
    const stream = fs.createReadStream(selectedImage);
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving background image:', error);
    res.status(500).json({ error: 'Error serving background image' });
  }
})

app.use(authMiddleware);

// Initialize indexing and monitoring systems
if (config.useCSharpIndexer && csharpIndexer.isAvailable()) {
  console.log('Using C# indexer for file indexing and monitoring...');
  
  // Start C# indexer
  csharpIndexer.start()
    .then(success => {
      if (success) {
        console.log('C# indexer started successfully');
        console.log('Node.js indexer and watcher are disabled in favor of C# indexer');
      } else {
        console.error('Failed to start C# indexer, falling back to Node.js indexer');
        initializeNodeIndexer();
      }
    })
    .catch(error => {
      console.error('Error starting C# indexer:', error.message);
      console.log('Falling back to Node.js indexer');
      initializeNodeIndexer();
    });

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down C# indexer...');
    await csharpIndexer.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down C# indexer...');
    await csharpIndexer.stop();
    process.exit(0);
  });

} else if (config.useFileIndex) {
  console.log('Using Node.js indexer...');
  initializeNodeIndexer();
} else {
  console.log('File indexing is disabled');
}

// Initialize Node.js file watcher if not using C# indexer
if (!config.useCSharpIndexer && config.useFileWatcher) {
  console.log('Initializing Node.js file watcher...');
  try {
    watcher.initialize() && watcher.startWatching(config.baseDirectory);
  } catch (error) {
    console.error('Error initializing file watcher:', error);
  } finally {
    console.log('File watcher initialized');
  }
}

function initializeNodeIndexer() {
  console.log('Initializing Node.js file indexer...');
  indexer.initializeDatabase();

  if (config.rebuildIndexOnStartup || !indexer.isIndexBuilt()) {
    console.log('Building file index...');
    indexer.buildIndex(config.baseDirectory)
      .then(result => {
        if (result.success) {
          console.log('File index built successfully');
          console.log(`Total files count: ${result.stats.total}`);
          console.log(`Files processed: ${result.stats.processed}`);
          console.log(`Errors: ${result.stats.errors}`);
          console.log(`Start time: ${result.stats.startTime}`);
          console.log(`Duration: ${new Date(result.stats.lastUpdated).getTime() - new Date(result.stats.startTime).getTime()}ms`);
        } else {
          console.error('Failed to build file index:', result.message);
        }
      })
      .catch(error => {
        console.error('Error building file index:', error);
      });
  } else {
    const stats = indexer.getIndexStats();
    console.log(`Using existing file index with ${stats.fileCount} files, last built on ${stats.lastBuilt}`);
  }

  // Initialize Node.js file watcher
  if (config.useFileWatcher) {
    console.log('Initializing Node.js file watcher...');
    try {
      watcher.initialize() && watcher.startWatching(config.baseDirectory);
    } catch (error) {
      console.error('Error initializing file watcher:', error);
    } finally {
      console.log('File watcher initialized');
    }
  }
}

app.get('/api/files', async (req, res) => {
  const { dir = '', cover = 'false', page, limit = 100, sortBy = 'name', sortOrder = 'asc' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const fullPath = path.join(basePath, dir);

  if (!fullPath.startsWith(basePath)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    // Use file index if enabled for files API
    if (config.useFileIndexForFilesApi && config.useFileIndex && indexer.isIndexBuilt()) {
      // Get directory files from index with pagination
      const result = await indexer.getDirectoryFiles(dir, page, limit, sortBy, sortOrder, cover === 'true');
      return res.json({
        files: result.files,
        total: result.total,
        hasMore: result.hasMore
      });
    }

    // Original file system based logic when indexer is not used
    if (config.parallelFileProcessing) {
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: "Not a directory" });
      }

      const files = await fs.promises.readdir(fullPath);

      const processFile = async (file) => {
        const filePath = path.join(fullPath, file);

        // limit the concurrency of file read
        return fileReadLimit(async () => {
          try {
            const [fileStats, mimeType] = await Promise.all([
              fs.promises.stat(filePath),
              utils.getFileType(filePath).catch(() => 'unknown')
            ]);

            const result = {
              name: file,
              path: utils.normalizePath(path.join(dir, file)),
              size: fileStats.size,
              mtime: fileStats.mtime,
              isDirectory: fileStats.isDirectory(),
              mimeType: fileStats.isDirectory() ? undefined : mimeType
            };

            if (cover === 'true' && result.isDirectory) {
              await processFolderCover(result, filePath, dir);
            }

            return result;
          } catch (error) {
            console.error(`Error processing ${filePath}:`, error);
            return {
              name: file,
              error: 'Failed to get file info'
            };
          }
        });
      };

      // handle partial failures
      const results = await Promise.allSettled(files.map(processFile));

      // filter valid results
      let fileDetails = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value);

      // Sort files
      fileDetails = sortFiles(fileDetails, sortBy, sortOrder);

      // Apply pagination
      const total = fileDetails.length;
      let hasMore = false;
      let paginatedFiles = fileDetails;

      if (page !== undefined) {
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 100;
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;

        hasMore = endIndex < total;
        paginatedFiles = fileDetails.slice(startIndex, endIndex);
      }

      res.json({
        files: paginatedFiles,
        total: total,
        hasMore: hasMore
      });

    } else {
      const stats = fs.statSync(fullPath);

      if (!stats.isDirectory()) {
        return res.status(400).json({ error: "Not a directory" })
      }

      const files = fs.readdirSync(fullPath);
      const fileDetailsPromises = files.map(async file => {
        const filePath = path.join(fullPath, file);
        const fileStats = fs.statSync(filePath);
        const isDirectory = fileStats.isDirectory();

        const fileDetail = {
          name: file,
          path: utils.normalizePath(path.join(dir, file)),
          size: fileStats.size,
          mtime: fileStats.mtime,
          isDirectory,
        };

        if (!isDirectory) {
          fileDetail.mimeType = await utils.getFileType(filePath);
        }

        if (cover === 'true' && isDirectory) {
          try {
            const subFiles = fs.readdirSync(filePath);
            const imageFilesPromises = await Promise.all(
              subFiles.map(async subFile => {
                const subFilePath = path.join(filePath, subFile);
                const mimeType = await utils.getFileType(subFilePath);
                return { subFile, mimeType };
              })
            );

            const imageFiles = imageFilesPromises
              .filter(({ mimeType }) => mimeType.startsWith('image/'))
              .map(({ subFile }) => subFile)
              .sort();

            if (imageFiles.length > 0) {
              const coverImage = imageFiles[0];
              fileDetail.cover = utils.normalizePath(path.join(dir, file, coverImage));
            }
          } catch (err) {
            // Silently fail if can't read subdirectory
          }
        }

        return fileDetail;
      });

      let fileDetails = await Promise.all(fileDetailsPromises);

      // Sort files
      fileDetails = sortFiles(fileDetails, sortBy, sortOrder);

      // Apply pagination
      const total = fileDetails.length;
      let hasMore = false;
      let paginatedFiles = fileDetails;

      if (page !== undefined) {
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 100;
        const startIndex = (pageNum - 1) * limitNum;
        const endIndex = startIndex + limitNum;

        hasMore = endIndex < total;
        paginatedFiles = fileDetails.slice(startIndex, endIndex);
      }

      res.json({
        files: paginatedFiles,
        total: total,
        hasMore: hasMore
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/search', (req, res) => {
  const { query, dir = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = 'false' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const isRecursive = recursive === 'true';

    // Use file index if enabled
    if (config.useFileIndex && indexer.isIndexBuilt()) {
      const searchResult = indexer.searchIndex(query, dir, page, limit, sortBy, sortOrder, isRecursive);
      return res.json(searchResult);
    }

    // Otherwise, use real-time search
    if (isRecursive) {
      // Use existing recursive search implementation
      parallelSearch(searchPath, query, basePath)
        .then(results => {
          // Sort results before pagination
          results = sortFiles(results, sortBy, sortOrder);

          // Apply pagination if specified
          let hasMore = false;
          let total = results.length;
          let paginatedResults = results;

          if (page !== undefined) {
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 100;
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;

            hasMore = endIndex < total;
            paginatedResults = results.slice(startIndex, endIndex);
          }

          // Format response to match the structure of paginated results
          res.json({
            results: paginatedResults,
            total: total,
            hasMore: hasMore
          });
        })
        .catch(error => {
          res.status(500).json({ error: error.message });
        });
    } else {
      // Non-recursive search - only search in the current directory
      searchFilesInDirectory(searchPath, query, basePath)
        .then(results => {
          // Sort results before pagination
          results = sortFiles(results, sortBy, sortOrder);

          // Apply pagination if specified
          let hasMore = false;
          let total = results.length;
          let paginatedResults = results;

          if (page !== undefined) {
            const pageNum = parseInt(page) || 1;
            const limitNum = parseInt(limit) || 100;
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;

            hasMore = endIndex < total;
            paginatedResults = results.slice(startIndex, endIndex);
          }

          // Format response to match the structure of paginated results
          res.json({
            results: paginatedResults,
            total: total,
            hasMore: hasMore
          });
        })
        .catch(error => {
          res.status(500).json({ error: error.message });
        });
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
});

app.get('/api/images', (req, res) => {
  const { dir = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = 'true' } = req.query;
  handleMediaFilesRequest(req, res, 'image', recursive === 'true', dir, page, limit, sortBy, sortOrder);
});

app.get('/api/images/random', (req, res) => {
  const { dir = '' } = req.query;

  // Only allow using this endpoint if file index is enabled and built
  if (!config.useFileIndex || !indexer.isIndexBuilt()) {
    return res.status(400).json({ error: "This endpoint requires the file index to be enabled and built" });
  }

  try {
    // Get a random image from the index
    const randomImage = indexer.getRandomImageFromIndex(dir);

    if (!randomImage) {
      return res.status(404).json({ error: "No images found" });
    }

    res.json({ image: randomImage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.get('/api/audios', (req, res) => {
  const { dir = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = 'false' } = req.query;
  handleMediaFilesRequest(req, res, 'audio', recursive === 'true', dir, page, limit, sortBy, sortOrder);
})

app.get('/api/audios/random', (req, res) => {
  const { dir = '' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  try {
    findMediaFilesInDirectory(searchPath, basePath, 'audio')
      .then(audios => {
        if (audios.length === 0) {
          return res.status(404).json({ error: "No audios found" });
        }
        const randomAudio = audios[Math.floor(Math.random() * audios.length)];
        res.json({ audio: randomAudio });
      })
      .catch(error => {
        res.status(500).json({ error: error.message });
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.get('/api/videos', (req, res) => {
  const { dir = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = 'false' } = req.query;
  handleMediaFilesRequest(req, res, 'video', recursive === 'true', dir, page, limit, sortBy, sortOrder);
})

app.get('/api/videos/random', (req, res) => {
  const { dir = '' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  try {
    findMediaFilesInDirectory(searchPath, basePath, 'video')
      .then(videos => {
        if (videos.length === 0) {
          return res.status(404).json({ error: "No videos found" });
        }
        const randomVideo = videos[Math.floor(Math.random() * videos.length)];
        res.json({ video: randomVideo });
      })
      .catch(error => {
        res.status(500).json({ error: error.message });
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.get('/api/download', (req, res) => {
  const { path: requestedPath, paths: requestedPaths } = req.query;
  const basePath = path.resolve(config.baseDirectory);

  if (!requestedPath && !requestedPaths) {
    return res.status(400).json({ error: 'No path or paths provided' });
  }

  let pathList = [];
  if (requestedPath) {
    pathList.push(path.join(basePath, requestedPath));
  }
  if (requestedPaths) {
    pathList = requestedPaths.split('|').map(p => path.join(basePath, p.trim()));
  }

  try {
    const zip = new AdmZip();

    for (const filePath of pathList) {

      if (!fullPath.startsWith(basePath)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stats = fs.statSync(filePath);

      if (stats.isDirectory()) {
        zip.addLocalFolder(filePath);
      } else {
        zip.addLocalFile(filePath);
      }
    }

    const zipBuffer = zip.toBuffer();
    // const fileName = path.basename(pathList[0]);
    const fileName = new Date().toISOString().replace(/[-:Z]/g, '');
    const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/raw', async (req, res) => {
  const { path: requestedPath } = req.query;
  const basePath = path.resolve(config.baseDirectory);

  // Detect if this is an absolute path (temp file) or relative path
  let fullPath;
  const tempDirPrefix = 'comic-extract-';

  // Check if it's a temp comic file path
  const isTempComicFile = requestedPath.includes(tempDirPrefix);

  if (isTempComicFile) {
    // For temp files, use the path directly
    fullPath = requestedPath;
  } else {
    // Regular case - relative path from base directory
    fullPath = path.join(basePath, requestedPath);
  }

  // Only prevent access to non-temp files outside the base directory
  if (!fullPath.startsWith(basePath) && !isTempComicFile) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      const zip = new AdmZip();
      zip.addLocalFolder(fullPath);
      const zipBuffer = zip.toBuffer();
      const fileName = path.basename(fullPath);
      const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}.zip`);
      res.send(zipBuffer);
    } else {
      const fileName = path.basename(fullPath);
      const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');

      // Get file mime type
      const mimeType = await utils.getFileType(fullPath);

      // Check if this is a PSD file that needs processing
      if (mimeType === 'image/vnd.adobe.photoshop' && config.processPsd) {
        // Process PSD file
        const processedFilePath = await processPsdFile(fullPath);

        if (processedFilePath) {
          // If processing was successful, serve the processed file
          const processedMimeType = config.psdFormat === 'png' ? 'image/png' : 'image/jpeg';
          res.setHeader('Content-Type', processedMimeType);
          res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}.${config.psdFormat}`);
          return fs.createReadStream(processedFilePath).pipe(res);
        }
        // If processing failed, fall back to original behavior
      }

      // Normal file handling
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodedFileName}`);
      res.sendFile(fullPath);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/content', async (req, res) => {
  const { path: requestedPath } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const fullPath = path.join(basePath, requestedPath);

  if (!fullPath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot show content of a directory' });
    }

    if (stats.size > config.contentMaxSize) {
      return res.status(413).json({ error: 'File too large to display' });
    }

    const contentType = await utils.getFileType(fullPath);
    if (!contentType.startsWith('text/')) {
      return res.status(400).json({ error: 'Cannot show content of a non-text file' });
    }
    const content = fs.readFileSync(fullPath, 'utf8');

    res.setHeader('Content-Type', contentType);
    res.send(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/thumbnail', async (req, res) => {
  const { path: requestedPath, width = 300, height, quality = 80 } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const fullPath = path.join(basePath, requestedPath);

  // Security check to ensure we don't access files outside base directory
  if (!fullPath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!config.generateThumbnail) {
    const mimeType = await utils.getFileType(fullPath);
    if (mimeType.startsWith('image/')) {
      res.setHeader('Content-Type', mimeType);
      return fs.createReadStream(fullPath).pipe(res);
    }
    return res.status(400).json({ error: 'Thumbnail generation is disabled' });
  }

  try {
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found', fullPath });
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot generate thumbnail for directory' });
    }

    const mimeType = await utils.getFileType(fullPath);
    if (mimeType.startsWith('image/')) {
      if (mimeType === 'image/bmp') {
        // Cause sharp cannot handle bmp files, I return the original file directly
        res.setHeader('Content-Type', 'image/bmp');
        return fs.createReadStream(fullPath).pipe(res);
      }
      if (mimeType === 'image/gif' && !config.generateThumbnailForGif) {
        res.setHeader('Content-Type', 'image/gif');
        return fs.createReadStream(fullPath).pipe(res);
      }
      if (mimeType === 'image/x-icon') {
        // Cause sharp cannot handle ico files, I return the original file directly
        res.setHeader('Content-Type', 'image/x-icon');
        return fs.createReadStream(fullPath).pipe(res);
      }
      if (mimeType === 'image/vnd.adobe.photoshop') {
        // If PSD processing is enabled, try to use the processed version for thumbnail
        if (config.processPsd) {
          const processedFilePath = await processPsdFile(fullPath);

          if (processedFilePath) {
            // Use the processed file to generate thumbnail with Sharp
            const sharp = require('sharp');

            // Cache mechanism: generate cache path using hash
            const cacheDir = config.thumbnailCacheDir || path.join(os.tmpdir(), 'thumbnails');
            if (!fs.existsSync(cacheDir)) {
              fs.mkdirSync(cacheDir, { recursive: true });
            }

            // Create cache filename using hash - include file path, modification time, and thumbnail parameters
            const hashInput = `${fullPath}-${stats.mtimeMs}-w${width}-h${height || 'auto'}-q${quality}`;
            const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
            const cachePath = path.join(cacheDir, `${cacheKey}.jpg`);

            // If cache exists, return cached thumbnail directly
            if (fs.existsSync(cachePath)) {
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for one year
              return fs.createReadStream(cachePath).pipe(res);
            }

            // Process with Sharp
            let transformer = sharp(processedFilePath)
              .rotate() // Auto-rotate based on EXIF data
              .resize({
                width: parseInt(width),
                height: height ? parseInt(height) : null,
                fit: 'inside',
                withoutEnlargement: true
              })
              .jpeg({ quality: parseInt(quality) });

            // Save to cache
            transformer
              .clone()
              .toFile(cachePath)
              .catch(err => {
                console.error('Error caching thumbnail:', err);
                if (fs.existsSync(cachePath)) {
                  fs.unlinkSync(cachePath);
                }
              });

            // Send to client
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return transformer.pipe(res);
          }
        }

        // If processing is disabled or failed, return the original file
        res.setHeader('Content-Type', 'image/vnd.adobe.photoshop');
        return fs.createReadStream(fullPath).pipe(res);
      }

      // Cache mechanism: generate cache path using hash
      const cacheDir = config.thumbnailCacheDir || path.join(os.tmpdir(), 'thumbnails');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Create cache filename using hash - include file path, modification time, and thumbnail parameters
      const hashInput = `${fullPath}-${stats.mtimeMs}-w${width}-h${height || 'auto'}-q${quality}`;
      const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
      const cachePath = path.join(cacheDir, `${cacheKey}.jpg`);

      // If cache exists, return cached thumbnail directly
      if (fs.existsSync(cachePath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for one year
        return fs.createReadStream(cachePath).pipe(res);
      }

      // Process image with Sharp library
      const sharp = require('sharp');

      let transformer = sharp(fullPath)
        .rotate() // Auto-rotate based on EXIF data
        .resize({
          width: parseInt(width),
          height: height ? parseInt(height) : null,
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: parseInt(quality) });

      // Save to cache
      transformer
        .clone()
        .toFile(cachePath)
        .catch(err => {
          console.error('Error caching thumbnail:', err);
          // Delete possibly generated incomplete file
          if (fs.existsSync(cachePath)) {
            fs.unlinkSync(cachePath);
          }
        });

      // Send to client
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      transformer.pipe(res);
    } else if (mimeType.startsWith('video/')) {

      // Cache mechanism: generate cache path using hash
      const cacheDir = config.thumbnailCacheDir || path.join(os.tmpdir(), 'thumbnails');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Create cache filename using hash - include file path, modification time, and thumbnail parameters
      const hashInput = `${fullPath}-${stats.mtimeMs}-w${width}-h${height || 'auto'}-q${quality}`;
      const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
      const cachePath = path.join(cacheDir, `${cacheKey}.jpg`);

      // If cache exists, return cached thumbnail directly
      if (fs.existsSync(cachePath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for one year
        return fs.createReadStream(cachePath).pipe(res);
      }

      // Process video with ffmpeg
      const ffmpeg = require('fluent-ffmpeg');

      const outputPath = path.join(cacheDir, `${cacheKey}.jpg`);

      ffmpeg(fullPath)
        .screenshots({
          timestamps: ['10%'],
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: `${width}x${height || '?'}`
        })
        .on('end', () => {
          // Send to client
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          fs.createReadStream(outputPath).pipe(res);
        })
        .on('error', (err) => {
          console.error('Error generating video thumbnail:', err);
          res.status(500).json({ error: 'Failed to generate thumbnail' });
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        });
    } else if (mimeType === 'application/epub+zip') {
      // Extract cover image from EPUB file using adm-zip
      try {
        // Cache mechanism: generate cache path using hash
        const cacheDir = config.thumbnailCacheDir || path.join(os.tmpdir(), 'thumbnails');
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }

        // Create cache filename using hash - include file path, modification time, and thumbnail parameters
        const hashInput = `${fullPath}-${stats.mtimeMs}-w${width}-h${height || 'auto'}-q${quality}`;
        const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');
        const cachePath = path.join(cacheDir, `${cacheKey}.jpg`);

        // If cache exists, return cached thumbnail directly
        if (fs.existsSync(cachePath)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for one year
          return fs.createReadStream(cachePath).pipe(res);
        }

        // Parse EPUB file as ZIP
        const zip = new AdmZip(fullPath);
        const entries = zip.getEntries();

        // Find container.xml to get the path to content.opf
        const containerEntry = entries.find(entry => entry.entryName === 'META-INF/container.xml');
        if (!containerEntry) {
          return res.status(404).json({ error: 'Invalid EPUB: container.xml not found' });
        }

        const containerXml = containerEntry.getData().toString('utf8');

        // Extract rootfile path from container.xml
        const rootfileMatch = containerXml.match(/<rootfile[^>]*full-path="([^"]*)"[^>]*>/);
        if (!rootfileMatch) {
          return res.status(404).json({ error: 'Invalid EPUB: rootfile not found in container.xml' });
        }

        const contentOpfPath = rootfileMatch[1];
        const contentOpfEntry = entries.find(entry => entry.entryName === contentOpfPath);
        if (!contentOpfEntry) {
          return res.status(404).json({ error: 'Invalid EPUB: content.opf not found' });
        }

        const contentOpfXml = contentOpfEntry.getData().toString('utf8');

        // Extract cover image ID from content.opf using multiple methods
        let coverId = null;

        // Method 1: Look for cover in metadata
        const metaMatches = contentOpfXml.match(/<meta[^>]*>/g);
        if (metaMatches) {
          for (const metaMatch of metaMatches) {
            // Split by spaces to get attributes
            const parts = metaMatch.split(/\s+/);
            let metaName = null;
            let metaContent = null;

            for (const part of parts) {
              if (part.startsWith('name=')) {
                // Extract name value
                const nameMatch = part.match(/name="([^"]*)"/);
                if (nameMatch) {
                  metaName = nameMatch[1];
                }
              } else if (part.startsWith('content=')) {
                // Extract content value
                const contentMatch = part.match(/content="([^"]*)"/);
                if (contentMatch) {
                  metaContent = contentMatch[1];
                }
              }
            }

            if (metaName === 'cover' && metaContent) {
              coverId = metaContent;
              break;
            }
          }
        }

        // Method 2: Look for cover in manifest with properties="cover-image" or id="cover"
        if (!coverId) {
          // Find all item tags and parse them more carefully
          const itemMatches = contentOpfXml.match(/<item[^>]*>/g);
          if (itemMatches) {
            for (const itemMatch of itemMatches) {
              // Split by spaces to get attributes
              const parts = itemMatch.split(/\s+/);

              let itemId = null;
              // Extract and check id value
              for (const part of parts) {
                if (part.startsWith('id=')) {
                  const idMatch = part.match(/id="([^"]*)"/);
                  if (idMatch) {
                    itemId = idMatch[1];
                    break;
                  }
                }
              }

              if (itemId === 'cover') {
                coverId = itemId;
                break;
              }

              // Extract and check properties value
              let itemProperties = null;
              for (const part of parts) {
                if (part.startsWith('properties=')) {
                  const propsMatch = part.match(/properties="([^"]*)"/);
                  if (propsMatch) {
                    itemProperties = propsMatch[1];
                    break;
                  }
                }
              }

              if (itemProperties === 'cover-image') {
                coverId = itemId;
                break;
              }
            }
          }
        }

        if (!coverId) {
          return res.status(404).json({ error: 'No cover image found in EPUB' });
        }

        // Find the cover image entry in manifest using the same parsing approach
        const coverItemMatches = contentOpfXml.match(/<item[^>]*>/g);
        let coverHref = null;

        if (coverItemMatches) {
          for (const itemMatch of coverItemMatches) {
            const parts = itemMatch.split(/\s+/);
            let itemId = null;
            let href = null;

            for (const part of parts) {
              if (part.startsWith('id=')) {
                const idMatch = part.match(/id="([^"]*)"/);
                if (idMatch) {
                  itemId = idMatch[1];
                }
              } else if (part.startsWith('href=')) {
                const hrefMatch = part.match(/href="([^"]*)"/);
                if (hrefMatch) {
                  href = hrefMatch[1];
                }
              }
            }

            if (itemId === coverId && href) {
              coverHref = href;
              break;
            }
          }
        }

        if (!coverHref) {
          return res.status(404).json({ error: 'Cover image not found in EPUB manifest' });
        }

        // Resolve relative path to absolute path within EPUB
        const contentOpfDir = path.dirname(contentOpfPath);
        const coverPath = path.join(contentOpfDir, coverHref).replace(/\\/g, '/');

        // Find the cover image in ZIP entries
        const coverEntry = entries.find(entry => entry.entryName === coverPath);
        if (!coverEntry) {
          return res.status(404).json({ error: 'Cover image file not found in EPUB' });
        }

        // Extract cover image data
        const coverData = coverEntry.getData();

        // Process cover image with Sharp
        const sharp = require('sharp');

        let transformer = sharp(coverData)
          .rotate() // Auto-rotate based on EXIF data
          .resize({
            width: parseInt(width),
            height: height ? parseInt(height) : null,
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: parseInt(quality) });

        // Save to cache
        transformer
          .clone()
          .toFile(cachePath)
          .catch(err => {
            console.error('Error caching EPUB thumbnail:', err);
            if (fs.existsSync(cachePath)) {
              fs.unlinkSync(cachePath);
            }
          });

        // Send to client
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        transformer.pipe(res);

      } catch (error) {
        console.error('Error extracting EPUB cover:', error);
        res.status(500).json({ error: 'Failed to extract EPUB cover' });
      }
    } else {
      res.status(400).json({ error: 'File is not supported' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/comic', async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'No file path provided' });
    }

    const basePath = path.resolve(config.baseDirectory);
    const fullPath = path.join(basePath, filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const extension = path.extname(fullPath).toLowerCase();
    const pages = [];

    // Get normalized temp directory prefix (for Windows path consistency)
    let tempDirBase = os.tmpdir();
    // On Windows, make sure we consistently use forward slashes
    if (process.platform === 'win32') {
      tempDirBase = tempDirBase.replace(/\\/g, '/');
    }

    // Create extraction directory name
    const extractionId = Date.now();
    const tempDirName = `comic-extract-${extractionId}`;

    if (extension === '.cbz') {
      // Handle CBZ files (ZIP format)
      try {
        const zip = new AdmZip(fullPath);
        const entries = zip.getEntries();

        // Filter image files
        const imageEntries = entries.filter(entry => {
          const ext = path.extname(entry.entryName).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        // Sort by filename
        imageEntries.sort((a, b) => {
          // Extract numbers from filenames for natural sorting
          const aMatch = a.entryName.match(/(\d+)/g);
          const bMatch = b.entryName.match(/(\d+)/g);

          if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[aMatch.length - 1]);
            const bNum = parseInt(bMatch[bMatch.length - 1]);
            return aNum - bNum;
          }

          return a.entryName.localeCompare(b.entryName);
        });

        // Create a temporary directory for extracted images
        const tempDir = path.join(tempDirBase, tempDirName);
        fs.mkdirSync(tempDir, { recursive: true });

        // Extract and create URLs for each image
        for (let i = 0; i < imageEntries.length; i++) {
          const entry = imageEntries[i];
          const entryPath = path.join(tempDir, entry.entryName);

          // Create directory structure if needed
          const entryDir = path.dirname(entryPath);
          fs.mkdirSync(entryDir, { recursive: true });

          // Extract the file
          zip.extractEntryTo(entry, entryDir, false, true);

          // Check if file exists after extraction
          if (!fs.existsSync(entryPath)) {
            continue;
          }

          // Create a direct raw URL for the image
          pages.push(`/api/raw?path=${encodeURIComponent(entryPath)}`);
        }
      } catch (error) {
        return res.status(500).json({ error: 'Failed to extract CBZ file' });
      }
    } else if (extension === '.cbr') {
      // Handle CBR files (RAR format)
      try {
        // Read RAR file
        const rarData = fs.readFileSync(fullPath);

        // Create extractor with buffer data
        const extractor = await unrar.createExtractorFromData({
          data: rarData.buffer,
          password: undefined // Add password here if needed
        });

        // Get file list
        const list = extractor.getFileList();
        if (!list || !list.fileHeaders) {
          throw new Error('Failed to read CBR file list');
        }

        // Convert iterable to array for processing
        const fileHeadersArray = [...list.fileHeaders];

        // Filter image files
        const imageEntries = fileHeadersArray.filter(header => {
          const ext = path.extname(header.name).toLowerCase();
          return ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        });

        // Sort by filename
        imageEntries.sort((a, b) => {
          // Extract numbers from filenames for natural sorting
          const aMatch = a.name.match(/(\d+)/g);
          const bMatch = b.name.match(/(\d+)/g);

          if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[aMatch.length - 1]);
            const bNum = parseInt(bMatch[bMatch.length - 1]);
            return aNum - bNum;
          }

          return a.name.localeCompare(b.name);
        });

        // Create a temporary directory for extracted images
        const tempDir = path.join(tempDirBase, tempDirName);
        fs.mkdirSync(tempDir, { recursive: true });

        // Extract the files - we need to extract all files, and then filter
        const extracted = extractor.extract();
        const files = [...extracted.files];

        // Process each file
        for (const file of files) {
          // Skip if not an image file
          const ext = path.extname(file.fileHeader.name).toLowerCase();
          if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
            continue;
          }

          // Get content
          if (!file.extraction) {
            continue;
          }

          // Save to temp file
          const entryPath = path.join(tempDir, file.fileHeader.name);

          // Create directory structure if needed
          const entryDir = path.dirname(entryPath);
          fs.mkdirSync(entryDir, { recursive: true });

          // Write the file
          fs.writeFileSync(entryPath, file.extraction);

          // Create a direct raw URL for the image
          pages.push(`/api/raw?path=${encodeURIComponent(entryPath)}`);
        }
      } catch (error) {
        return res.status(500).json({ error: 'Failed to extract CBR file' });
      }
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    return res.json({ pages });
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/archive', (req, res) => {
  // TODO: Implement archive endpoint
})


app.post('/api/upload', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const uploadPath = path.join(basePath, dir);

  if (!uploadPath.startsWith(basePath)) {
    return res.status(403).json({ error: "Access denied" });
  }

  if (!fs.existsSync(uploadPath)) {
    return res.status(400).json({ error: "Upload directory does not exist" });
  }

  // Configure multer storage
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, decodedName);
    }
  });

  // File filter to reject unwanted files
  const fileFilter = (req, file, cb) => {
    // You can add file type restrictions here if needed
    cb(null, true);
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: config.uploadSizeLimit
    }
  }).array('files', config.uploadCountLimit);

  upload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: `Server error: ${err.message}` });
    }

    const uploadedFiles = req.files.map(file => ({
      name: file.originalname,
      path: path.join(dir, file.originalname).replace(/\\/g, '/'),
      size: file.size,
      mimetype: file.mimetype
    }));

    // Update indexer if enabled
    if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
      try {
        // Prepare files for indexer in the required format
        const filesForIndex = uploadedFiles.map(file => ({
          name: file.name,
          path: file.path,
          size: file.size,
          mtime: new Date().toISOString(),
          mimeType: file.mimetype,
          isDirectory: false
        }));

        // Add files to the index
        indexer.saveFileBatch(filesForIndex);
        console.log(`Added ${filesForIndex.length} uploaded files to the index`);
      } catch (error) {
        console.error('Error updating index with uploaded files:', error);
      }
    }

    res.status(200).json({
      message: 'Files uploaded successfully',
      files: uploadedFiles
    });
  });
})

app.post('/api/upload-folder', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const uploadPath = path.join(basePath, dir);

  if (!uploadPath.startsWith(basePath)) {
    return res.status(403).json({ error: "Access denied" });
  }

  // Ensure upload directory exists
  if (!fs.existsSync(uploadPath)) {
    return res.status(400).json({ error: "Upload directory does not exist" });
  }

  // Configure multer storage with directory structure preservation
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      // Extract directory path from the webkitRelativePath field
      let relativePath = '';
      if (file.originalname.includes('/')) {
        relativePath = file.originalname.substring(0, file.originalname.lastIndexOf('/'));
      } else if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        parts.pop(); // Remove the filename
        relativePath = parts.join('/');
      }

      // Create full directory path
      const fullPath = path.join(uploadPath, relativePath);

      // Create nested directories if they don't exist
      try {
        fs.mkdirSync(fullPath, { recursive: true });
      } catch (error) {
        console.error(`Failed to create directory structure: ${error.message}`);
        // Continue anyway, multer will handle the error if the directory doesn't exist
      }

      cb(null, fullPath);
    },
    filename: function (req, file, cb) {
      // Extract just the filename without path
      let fileName = file.originalname;
      if (fileName.includes('/')) {
        fileName = fileName.substring(fileName.lastIndexOf('/') + 1);
      } else if (file.webkitRelativePath) {
        fileName = file.webkitRelativePath.split('/').pop();
      }

      const decodedName = Buffer.from(fileName, 'latin1').toString('utf8');
      cb(null, decodedName);
    }
  });

  // File filter to reject unwanted files
  const fileFilter = (req, file, cb) => {
    // You can add file type restrictions here if needed
    cb(null, true);
  };

  const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
      fileSize: config.uploadSizeLimit
    }
  }).array('files', config.uploadCountLimit);

  upload(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: `Server error: ${err.message}` });
    }

    const uploadedFiles = req.files.map(file => {
      // Calculate the relative path from the base upload directory
      const relativePath = path.relative(uploadPath, file.path);
      return {
        name: file.originalname,
        path: path.join(dir, relativePath).replace(/\\/g, '/'),
        size: file.size,
        mimetype: file.mimetype
      };
    });

    // Update indexer if enabled
    if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
      try {
        // Prepare files for indexer in the required format
        const filesForIndex = uploadedFiles.map(file => ({
          name: file.name,
          path: file.path,
          size: file.size,
          mtime: new Date().toISOString(),
          mimeType: file.mimetype,
          isDirectory: false
        }));

        // We also need to add created directories to the index
        const createdDirs = new Set();
        uploadedFiles.forEach(file => {
          const filePath = file.path;
          const dirPath = path.dirname(filePath);

          if (dirPath !== '.' && dirPath !== '' && !createdDirs.has(dirPath)) {
            // Collect all parent directories
            let currentDir = dirPath;
            while (currentDir !== '.' && currentDir !== '') {
              createdDirs.add(currentDir);
              currentDir = path.dirname(currentDir);
            }
          }
        });

        // Add directories to the index files
        createdDirs.forEach(dirPath => {
          const dirName = path.basename(dirPath);
          filesForIndex.push({
            name: dirName,
            path: dirPath,
            size: 0, // Directories have no size
            mtime: new Date().toISOString(),
            mimeType: 'directory',
            isDirectory: true
          });
        });

        // Add files to the index
        indexer.saveFileBatch(filesForIndex);
        console.log(`Added ${filesForIndex.length} uploaded files and directories to the index`);
      } catch (error) {
        console.error('Error updating index with uploaded files:', error);
      }
    }

    res.status(200).json({
      message: 'Files and folders uploaded successfully',
      files: uploadedFiles
    });
  });
})

app.post('/api/mkdir', writePermissionMiddleware, (req, res) => {
  const { path: dirPath, name: dirName } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const fullPath = path.join(basePath, dirPath, dirName);

  if (!fullPath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    fs.mkdirSync(fullPath, { recursive: true });

    // Update indexer if enabled
    if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
      try {
        const stats = fs.statSync(fullPath);
        const relativePath = path.join(dirPath, dirName).replace(/\\/g, '/');

        // Add directory to the index
        indexer.saveFileBatch([{
          name: dirName,
          path: relativePath,
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          mimeType: 'directory',
          isDirectory: true
        }]);
        console.log(`Added new directory "${relativePath}" to the index`);
      } catch (error) {
        console.error('Error updating index with new directory:', error);
      }
    }

    res.status(200).json({ message: 'Directory created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.post('/api/rename', writePermissionMiddleware, async (req, res) => {
  const { path: filePath, newName } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const fullPath = path.join(basePath, filePath);
  const newPath = path.join(path.dirname(fullPath), newName);

  if (!fullPath.startsWith(basePath) || !newPath.startsWith(basePath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // Get stats before renaming to determine if it's a directory
    const stats = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
    const isDirectory = stats ? stats.isDirectory() : false;

    fs.renameSync(fullPath, newPath);

    // Update indexer if enabled
    if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
      try {
        // Delete the old entry
        indexer.deleteFromIndex(filePath);

        if (isDirectory) {
          // For directories, we need to update all child paths too
          // This is handled by the deleteFromIndex function already

          // Now add the new directory
          const newStats = fs.statSync(newPath);
          indexer.saveFileBatch([{
            name: path.basename(newName),
            path: newName,
            size: newStats.size,
            mtime: newStats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
          }]);

          // Reindex the directory contents with updated paths
          const reindexDirectory = async (dirPath, baseDirPath) => {
            try {
              const entries = fs.readdirSync(dirPath);
              const fileBatch = [];

              for (const entry of entries) {
                const entryPath = path.join(dirPath, entry);
                const entryStats = fs.statSync(entryPath);
                const relativePath = path.relative(basePath, entryPath).replace(/\\/g, '/');

                if (entryStats.isDirectory()) {
                  // Add directory entry
                  fileBatch.push({
                    name: entry,
                    path: relativePath,
                    size: entryStats.size,
                    mtime: entryStats.mtime.toISOString(),
                    mimeType: 'directory',
                    isDirectory: true
                  });

                  // Recursively process subdirectories
                  await reindexDirectory(entryPath, baseDirPath);
                } else {
                  // Add file entry
                  const mimeType = await utils.getFileType(entryPath);
                  fileBatch.push({
                    name: entry,
                    path: relativePath,
                    size: entryStats.size,
                    mtime: entryStats.mtime.toISOString(),
                    mimeType: mimeType,
                    isDirectory: false
                  });
                }
              }

              // Save batch of files/directories to the index
              if (fileBatch.length > 0) {
                indexer.saveFileBatch(fileBatch);
              }
            } catch (error) {
              console.error(`Error reindexing directory ${dirPath}:`, error);
            }
          };

          // Start reindexing the moved directory
          await reindexDirectory(newPath, basePath);
        } else {
          // For files, just add the new entry
          const newStats = fs.statSync(newPath);
          const mimeType = await utils.getFileType(newPath);

          indexer.saveFileBatch([{
            name: path.basename(newName),
            path: newName,
            size: newStats.size,
            mtime: newStats.mtime.toISOString(),
            mimeType: mimeType,
            isDirectory: false
          }]);
        }

        console.log(`Updated index for renamed item from "${filePath}" to "${newName}"`);
      } catch (error) {
        console.error('Error updating index after rename:', error);
      }
    }

    res.status(200).json({ message: 'File renamed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

app.delete('/api/delete', writePermissionMiddleware, (req, res) => {
  const { path: filePath, paths: filePaths } = req.query;

  if (!filePath && !filePaths) {
    return res.status(400).json({ error: 'No file path provided' });
  }

  if (filePath) {
    const basePath = path.resolve(config.baseDirectory);
    const fullPath = path.join(basePath, filePath);

    if (!fullPath.startsWith(basePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const isDirectory = fs.statSync(fullPath).isDirectory();

      if (isDirectory) {
        const success = utils.safeDeleteDirectory(fullPath);

        // Update indexer if enabled
        if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
          indexer.deleteFromIndex(filePath);
          console.log(`Removed directory "${filePath}" from index`);
        }

        if (success) {
          res.status(200).json({ message: 'Directory deleted successfully' });
        } else {
          res.status(500).json({ error: 'Failed to completely delete directory' });
        }
      } else {
        fs.unlinkSync(fullPath);

        // Update indexer if enabled
        if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
          indexer.deleteFromIndex(filePath);
          console.log(`Removed file "${filePath}" from index`);
        }

        res.status(200).json({ message: 'File deleted successfully' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
    return;
  } else {
    const basePath = path.resolve(config.baseDirectory);
    const fullPaths = filePaths.split('|').map(p => path.join(basePath, p.trim()));
    const relativePaths = filePaths.split('|').map(p => p.trim());

    for (let i = 0; i < fullPaths.length; i++) {
      const fullPath = fullPaths[i];
      const relativePath = relativePaths[i];

      if (!fullPath.startsWith(basePath)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      try {
        const isDirectory = fs.statSync(fullPath).isDirectory();

        if (isDirectory) {
          const success = utils.safeDeleteDirectory(fullPath);
          if (!success) {
            return res.status(500).json({ error: 'Failed to completely delete directory' });
          }

          // Update indexer if enabled
          if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
            indexer.deleteFromIndex(relativePath);
          }
        } else {
          fs.unlinkSync(fullPath);

          // Update indexer if enabled
          if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
            indexer.deleteFromIndex(relativePath);
          }
        }
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (config.useFileIndex && indexer.isIndexBuilt()) {
      console.log(`Removed ${fullPaths.length} items from index`);
    }

    res.status(200).json({ message: 'Files deleted successfully' });
  }
})

app.post('/api/clone', writePermissionMiddleware, (req, res) => {
  const { sources, destination } = req.body;
  const basePath = path.resolve(config.baseDirectory);

  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: 'No sources provided' });
  }

  const results = [];
  try {
    const destDir = path.join(basePath, destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });

      // Add new directory to index if it didn't exist before
      if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
        const destStats = fs.statSync(destDir);
        indexer.saveFileBatch([{
          name: path.basename(destination),
          path: destination,
          size: destStats.size,
          mtime: destStats.mtime.toISOString(),
          mimeType: 'directory',
          isDirectory: true
        }]);
      }
    }

    // Collect all files to be indexed after cloning
    const filesToIndex = [];

    for (const source of sources) {
      const sourcePath = path.join(basePath, source);
      const destPath = path.join(destDir, path.basename(source));

      if (!sourcePath.startsWith(basePath) || !destPath.startsWith(basePath)) {
        results.push({ source, status: 'failed', error: 'Access denied' });
        continue;
      }

      try {
        if (!fs.existsSync(sourcePath)) {
          results.push({ source, status: 'failed', error: 'Source not found' });
          continue;
        }

        const stats = fs.statSync(sourcePath);
        const relativeDest = path.relative(basePath, destPath).replace(/\\/g, '/');

        if (stats.isDirectory()) {
          copyFolderRecursiveSync(sourcePath, destPath);

          // For indexing, we need to collect all files in the directory
          if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
            // First add the directory itself
            filesToIndex.push({
              name: path.basename(source),
              path: relativeDest,
              size: stats.size,
              mtime: new Date().toISOString(),
              mimeType: 'directory',
              isDirectory: true
            });

            // Schedule the directory content for indexing
            setTimeout(() => {
              indexDirectoryRecursively(destPath, basePath)
                .then(indexedCount => {
                  console.log(`Indexed ${indexedCount} items from cloned directory ${relativeDest}`);
                })
                .catch(err => {
                  console.error(`Error indexing cloned directory ${relativeDest}:`, err);
                });
            }, 0);
          }
        } else {
          fs.copyFileSync(sourcePath, destPath);

          // Add file to index
          if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
            const newStats = fs.statSync(destPath);
            // Get file type asynchronously but don't wait for it, add to index after
            utils.getFileType(destPath)
              .then(mimeType => {
                indexer.saveFileBatch([{
                  name: path.basename(source),
                  path: relativeDest,
                  size: newStats.size,
                  mtime: newStats.mtime.toISOString(),
                  mimeType: mimeType,
                  isDirectory: false
                }]);
              })
              .catch(err => {
                console.error(`Error getting file type for ${destPath}:`, err);
              });
          }
        }
        results.push({ source, status: 'success', destination: path.relative(basePath, destPath) });
      } catch (error) {
        results.push({ source, status: 'failed', error: error.message });
      }
    }

    // Add non-directory files to index in a batch
    if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt() && filesToIndex.length > 0) {
      indexer.saveFileBatch(filesToIndex);
      console.log(`Added ${filesToIndex.length} cloned items to the index`);
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/move', writePermissionMiddleware, (req, res) => {
  const { sources, destination } = req.body;
  const basePath = path.resolve(config.baseDirectory);

  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    return res.status(400).json({ error: 'No sources provided' });
  }

  const results = [];
  try {
    const destDir = path.join(basePath, destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });

      // Add new directory to index if it didn't exist before
      if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
        const destStats = fs.statSync(destDir);
        indexer.saveFileBatch([{
          name: path.basename(destination),
          path: destination,
          size: destStats.size,
          mtime: destStats.mtime.toISOString(),
          mimeType: 'directory',
          isDirectory: true
        }]);
      }
    }

    for (const source of sources) {
      const sourcePath = path.join(basePath, source);
      const destPath = path.join(destDir, path.basename(source));

      if (!sourcePath.startsWith(basePath) || !destPath.startsWith(basePath)) {
        results.push({ source, status: 'failed', error: 'Access denied' });
        continue;
      }

      try {
        if (!fs.existsSync(sourcePath)) {
          results.push({ source, status: 'failed', error: 'Source not found' });
          continue;
        }

        // Check if it's a directory before moving for indexer update
        const isDirectory = fs.statSync(sourcePath).isDirectory();
        const relativeDest = path.relative(basePath, destPath).replace(/\\/g, '/');

        fs.renameSync(sourcePath, destPath);

        // Update index if enabled
        if (config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt()) {
          try {
            // Delete the old entry (and all its children if it's a directory)
            indexer.deleteFromIndex(source);

            if (isDirectory) {
              // Add the moved directory
              const newStats = fs.statSync(destPath);
              indexer.saveFileBatch([{
                name: path.basename(source),
                path: relativeDest,
                size: newStats.size,
                mtime: newStats.mtime.toISOString(),
                mimeType: 'directory',
                isDirectory: true
              }]);

              // Schedule directory reindexing
              setTimeout(() => {
                indexDirectoryRecursively(destPath, basePath)
                  .then(indexedCount => {
                    console.log(`Indexed ${indexedCount} items from moved directory ${relativeDest}`);
                  })
                  .catch(err => {
                    console.error(`Error indexing moved directory ${relativeDest}:`, err);
                  });
              }, 0);
            } else {
              // Add the moved file
              const newStats = fs.statSync(destPath);
              utils.getFileType(destPath)
                .then(mimeType => {
                  indexer.saveFileBatch([{
                    name: path.basename(source),
                    path: relativeDest,
                    size: newStats.size,
                    mtime: newStats.mtime.toISOString(),
                    mimeType: mimeType,
                    isDirectory: false
                  }]);
                })
                .catch(err => {
                  console.error(`Error getting file type for ${destPath}:`, err);
                });
            }
          } catch (error) {
            console.error(`Error updating index for moved item ${source}:`, error);
          }
        }

        results.push({ source, status: 'success', destination: path.relative(basePath, destPath) });
      } catch (error) {
        results.push({ source, status: 'failed', error: error.message });
      }
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.get('/api/index-status', (req, res) => {
  if (config.useCSharpIndexer && csharpIndexer.isAvailable()) {
    const status = csharpIndexer.getStatus();
    return res.json({
      enabled: true,
      type: 'csharp',
      isRunning: status.isRunning,
      processId: status.processId,
      restartCount: status.restartCount,
      executablePath: status.executablePath,
      baseDirectory: status.baseDirectory,
      databasePath: status.databasePath
    });
  } else if (config.useFileIndex) {
    const stats = indexer.getIndexStats();
    return res.json({
      enabled: true,
      type: 'nodejs',
      ...stats
    });
  } else {
    return res.json({ enabled: false });
  }
});

app.post('/api/rebuild-index', writePermissionMiddleware, async (req, res) => {
  if (config.useCSharpIndexer && csharpIndexer.isAvailable()) {
    try {
      const success = await csharpIndexer.restart();
      if (success) {
        return res.json({ message: "C# indexer restarted successfully", type: 'csharp' });
      } else {
        return res.status(500).json({ error: "Failed to restart C# indexer" });
      }
    } catch (error) {
      return res.status(500).json({ error: `Error restarting C# indexer: ${error.message}` });
    }
  } else if (config.useFileIndex) {
    const stats = indexer.getIndexStats();
    if (stats.isBuilding) {
      return res.status(409).json({ error: "Index is already being built", progress: stats.progress });
    }

    // Start rebuilding index in background
    indexer.buildIndex(config.baseDirectory)
      .then(result => {
        console.log(result.success ? 'Index rebuilt successfully' : 'Failed to rebuild index');
      })
      .catch(error => {
        console.error('Error rebuilding index:', error);
      });

    res.json({ message: "Index rebuild started", progress: indexer.getIndexStats().progress, type: 'nodejs' });
  } else {
    return res.status(400).json({ error: "File indexing is not enabled" });
  }
});

app.get('/api/watcher-status', (req, res) => {
  if (config.useCSharpIndexer && csharpIndexer.isAvailable()) {
    const status = csharpIndexer.getStatus();
    return res.json({
      enabled: true,
      type: 'csharp',
      active: status.isRunning,
      processId: status.processId,
      restartCount: status.restartCount
    });
  } else if (config.useFileWatcher) {
    const status = watcher.getStatus();
    return res.json({
      enabled: true,
      type: 'nodejs',
      ...status
    });
  } else {
    return res.json({ enabled: false });
  }
});

app.post('/api/toggle-watcher', writePermissionMiddleware, async (req, res) => {
  if (config.useCSharpIndexer && csharpIndexer.isAvailable()) {
    try {
      const status = csharpIndexer.getStatus();
      
      if (status.isRunning) {
        await csharpIndexer.stop();
        return res.json({ message: "C# indexer stopped", active: false, type: 'csharp' });
      } else {
        const success = await csharpIndexer.start();
        return res.json({
          message: success ? "C# indexer started" : "Failed to start C# indexer",
          active: success,
          type: 'csharp'
        });
      }
    } catch (error) {
      return res.status(500).json({ error: `Error toggling C# indexer: ${error.message}` });
    }
  } else if (config.useFileWatcher) {
    const status = watcher.getStatus();

    if (status.active) {
      watcher.stopWatching();
      return res.json({ message: "File watcher stopped", active: false, type: 'nodejs' });
    } else {
      const started = watcher.startWatching(config.baseDirectory);
      return res.json({
        message: started ? "File watcher started" : "Failed to start file watcher",
        active: started,
        type: 'nodejs'
      });
    }
  } else {
    return res.status(400).json({ error: "File watching is not enabled in config" });
  }
});

app.get('/api/csharp-indexer-status', (req, res) => {
  if (!config.useCSharpIndexer) {
    return res.json({ enabled: false, reason: 'C# indexer is disabled in configuration' });
  }

  if (!csharpIndexer.isAvailable()) {
    return res.json({ 
      enabled: false, 
      reason: 'C# indexer executable not found',
      executablePath: config.cSharpIndexerPath
    });
  }

  const status = csharpIndexer.getStatus();
  return res.json({
    enabled: true,
    ...status,
    configuration: {
      forceRebuild: config.cSharpIndexerForceRebuild,
      startupTimeout: config.cSharpIndexerStartupTimeout,
      autoRestart: config.cSharpIndexerAutoRestart,
      maxRestarts: config.cSharpIndexerMaxRestarts,
      restartDelay: config.cSharpIndexerRestartDelay
    }
  });
});

app.post('/api/csharp-indexer/restart', writePermissionMiddleware, async (req, res) => {
  if (!config.useCSharpIndexer || !csharpIndexer.isAvailable()) {
    return res.status(400).json({ error: "C# indexer is not enabled or available" });
  }

  try {
    const success = await csharpIndexer.restart();
    res.json({ 
      success, 
      message: success ? "C# indexer restarted successfully" : "Failed to restart C# indexer",
      status: csharpIndexer.getStatus()
    });
  } catch (error) {
    res.status(500).json({ error: `Error restarting C# indexer: ${error.message}` });
  }
});

function handleMediaFilesRequest(req, res, mediaType, isRecursive, dir, page, limit, sortBy, sortOrder) {
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  if (!searchPath.startsWith(basePath)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    // Use file index if enabled
    if (config.useFileIndex && indexer.isIndexBuilt()) {
      // For images, use the existing method
      if (mediaType === 'image') {
        const mediaResult = indexer.findImagesInIndex(dir, page, limit, sortBy, sortOrder, isRecursive);
        return res.json(mediaResult);
      }
      // For other media types, fall back to real-time search since indexer doesn't have specific methods
    }

    // Otherwise, use real-time search
    if (isRecursive) {
      // Use parallel search for recursive
      parallelFindMedia(searchPath, basePath, mediaType)
        .then(mediaFiles => {
          // Sort media files before pagination
          if (sortBy === 'name') {
            mediaFiles = sortFiles(mediaFiles, 'path', sortOrder);
          } else {
            mediaFiles = sortFiles(mediaFiles, sortBy, sortOrder);
          }

          // Apply pagination if specified
          const result = applyPagination(mediaFiles, page, limit);

          // Format response to match the structure of paginated results
          const responseKey = mediaType + 's';
          const response = {
            [responseKey]: result.paginatedItems,
            total: result.total,
            hasMore: result.hasMore
          };

          res.json(response);
        })
        .catch(error => {
          res.status(500).json({ error: error.message });
        });
    } else {
      // Non-recursive search - only find media in the current directory
      findMediaFilesInDirectory(searchPath, basePath, mediaType)
        .then(mediaFiles => {
          // Sort media files before pagination
          if (sortBy === 'name') {
            mediaFiles = sortFiles(mediaFiles, 'path', sortOrder);
          } else {
            mediaFiles = sortFiles(mediaFiles, sortBy, sortOrder);
          }

          // Apply pagination if specified
          const result = applyPagination(mediaFiles, page, limit);

          // Format response to match the structure of paginated results
          const responseKey = mediaType + 's';
          const response = {
            [responseKey]: result.paginatedItems,
            total: result.total,
            hasMore: result.hasMore
          };

          res.json(response);
        })
        .catch(error => {
          res.status(500).json({ error: error.message });
        });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

function applyPagination(items, page, limit) {
  const total = items.length;
  let hasMore = false;
  let paginatedItems = items;

  if (page !== undefined) {
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 100;
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;

    hasMore = endIndex < total;
    paginatedItems = items.slice(startIndex, endIndex);
  }

  return {
    paginatedItems,
    total,
    hasMore
  };
}

async function searchFiles(dir, query, basePath) {
  let results = [];

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);

      if (file.toLowerCase().includes(query.toLowerCase())) {
        const fileDetail = {
          name: file,
          path: utils.normalizePath(path.relative(basePath, fullPath)),
          size: stats.size,
          mtime: stats.mtime,
          isDirectory: stats.isDirectory(),
        }

        if (!stats.isDirectory()) {
          fileDetail.mimeType = await utils.getFileType(fullPath);
        }

        results.push(fileDetail);
      }

      if (stats.isDirectory()) {
        results = results.concat(await searchFiles(fullPath, query, basePath));
      }
    }
  } catch (error) {
    console.error('Error searching files:', error);
  }

  return results;
}

async function findAllImages(dir, basePath) {
  return await findAllMediaFiles(dir, basePath, 'image');
}

async function findAllMediaFiles(dir, basePath, mediaType) {
  let results = [];

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        results = results.concat(await findAllMediaFiles(fullPath, basePath, mediaType));
      } else {
        const mimeType = await utils.getFileType(fullPath);
        if (mimeType.startsWith(mediaType + '/')) {
          results.push({
            name: file,
            path: utils.normalizePath(path.relative(basePath, fullPath)),
            size: stats.size,
            mtime: stats.mtime,
            mimeType: mimeType,
            isDirectory: false
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error finding ${mediaType} files:`, error);
  }

  return results;
}

async function searchFilesInDirectory(dir, query, basePath) {
  let results = [];

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);

      if (file.toLowerCase().includes(query.toLowerCase())) {
        const mimeType = await utils.getFileType(fullPath);
        results.push({
          name: file,
          path: utils.normalizePath(path.relative(basePath, fullPath)),
          size: stats.size,
          mtime: stats.mtime,
          mimeType: mimeType,
          isDirectory: stats.isDirectory()
        });
      }
    }
  } catch (error) {
    console.error('Error searching files in directory:', error);
  }

  return results;
}

async function findMediaFilesInDirectory(dir, basePath, mediaType) {
  let results = [];

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stats = fs.statSync(fullPath);

      if (!stats.isDirectory()) {
        const mimeType = await utils.getFileType(fullPath);
        if (mimeType.startsWith(mediaType + '/')) {
          results.push({
            name: file,
            path: utils.normalizePath(path.relative(basePath, fullPath)),
            size: stats.size,
            mtime: stats.mtime,
            mimeType: mimeType,
            isDirectory: false
          });
        }
      }
    }
  } catch (error) {
    console.error(`Error finding ${mediaType} files in directory:`, error);
  }

  return results;
}

async function findImagesInDirectory(dir, basePath) {
  return await findMediaFilesInDirectory(dir, basePath, 'image');
}

async function findAudiosInDirectory(dir, basePath) {
  return await findMediaFilesInDirectory(dir, basePath, 'audio');
}

async function findVideosInDirectory(dir, basePath) {
  return await findMediaFilesInDirectory(dir, basePath, 'video');
}

async function parallelSearch(dir, query, basePath) {
  if (isMainThread) {
    try {
      const subdirs = utils.getSubdirectories(dir);

      if (subdirs.length === 0) {
        return await searchFiles(dir, query, basePath);
      }

      const numCores = os.cpus().length;
      const numWorkers = Math.min(subdirs.length, numCores);
      const tasksPerWorker = Math.ceil(subdirs.length / numWorkers);
      const workers = [];

      for (let i = 0; i < numWorkers; i++) {
        const start = i * tasksPerWorker;
        const end = Math.min(start + tasksPerWorker, subdirs.length);
        const workerSubdirs = subdirs.slice(start, end);

        workers.push(createSearchWorker(workerSubdirs, query, basePath));
      }

      const rootResults = await searchFilesInDirectory(dir, query, basePath);
      const workerResults = await Promise.all(workers);

      return rootResults.concat(...workerResults);
    } catch (error) {
      return res.status(500).json({ error: 'Server error' });
    }
  }
}

async function parallelFindMedia(dir, basePath, mediaType) {
  if (isMainThread) {
    try {
      const subdirs = utils.getSubdirectories(dir);

      if (subdirs.length === 0) {
        return await findAllMediaFiles(dir, basePath, mediaType);
      }

      const numCores = os.cpus().length;
      const numWorkers = Math.min(subdirs.length, numCores);
      const tasksPerWorker = Math.ceil(subdirs.length / numWorkers);
      const workers = [];

      for (let i = 0; i < numWorkers; i++) {
        const start = i * tasksPerWorker;
        const end = Math.min(start + tasksPerWorker, subdirs.length);
        const workerSubdirs = subdirs.slice(start, end);

        workers.push(createMediaWorker(workerSubdirs, basePath, mediaType));
      }

      const rootResults = await findMediaFilesInDirectory(dir, basePath, mediaType);
      const workerResults = await Promise.all(workers);

      return rootResults.concat(...workerResults);
    } catch (error) {
      throw new Error('Server error');
    }
  }
}

async function parallelFindImages(dir, basePath) {
  return await parallelFindMedia(dir, basePath, 'image');
}

function createSearchWorker(directories, query, basePath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { task: 'search', directories, query, basePath }
    });

    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

function createMediaWorker(directories, basePath, mediaType) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { task: 'findMedia', directories, basePath, mediaType }
    });

    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}

function createImageWorker(directories, basePath) {
  return createMediaWorker(directories, basePath, 'image');
}

if (!isMainThread) {
  const { task, directories, query, basePath, mediaType } = workerData;

  if (task === 'search') {
    (async () => {
      let results = [];

      for (const dir of directories) {
        try {
          const searchResults = await searchFiles(dir, query, basePath);
          results = results.concat(searchResults);
        } catch (error) {
          console.error(`Error searching in directory ${dir}:`, error);
        }
      }

      parentPort.postMessage(results);
    })();
  } else if (task === 'findImages') {
    (async () => {
      let results = [];

      for (const dir of directories) {
        try {
          const imageResults = await findAllMediaFiles(dir, basePath, 'image');
          results = results.concat(imageResults);
        } catch (error) {
          console.error(`Error finding images in directory ${dir}:`, error);
        }
      }

      parentPort.postMessage(results);
    })();
  } else if (task === 'findMedia') {
    (async () => {
      let results = [];

      for (const dir of directories) {
        try {
          const mediaResults = await findAllMediaFiles(dir, basePath, mediaType);
          results = results.concat(mediaResults);
        } catch (error) {
          console.error(`Error finding ${mediaType} files in directory ${dir}:`, error);
        }
      }

      parentPort.postMessage(results);
    })();
  }
}

async function indexDirectoryRecursively(dirPath, basePath) {
  if (!config.useFileIndex || !indexer.isIndexBuilt()) return 0;

  try {
    const fileBatch = [];
    const stack = [dirPath];
    let indexedCount = 0;

    while (stack.length > 0) {
      const currentDir = stack.pop();
      const entries = fs.readdirSync(currentDir);

      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry);
        const entryStats = fs.statSync(entryPath);
        const relativePath = path.relative(basePath, entryPath).replace(/\\/g, '/');

        if (entryStats.isDirectory()) {
          // Add directory to batch
          fileBatch.push({
            name: entry,
            path: relativePath,
            size: entryStats.size,
            mtime: entryStats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
          });

          // Add to stack for processing
          stack.push(entryPath);
        } else {
          // Get file type and add to batch
          const mimeType = await utils.getFileType(entryPath);
          fileBatch.push({
            name: entry,
            path: relativePath,
            size: entryStats.size,
            mtime: entryStats.mtime.toISOString(),
            mimeType: mimeType,
            isDirectory: false
          });
        }

        indexedCount++;

        // Save batch when it reaches a reasonable size
        if (fileBatch.length >= 100) {
          indexer.saveFileBatch(fileBatch);
          fileBatch.length = 0;
        }
      }
    }

    // Save any remaining files
    if (fileBatch.length > 0) {
      indexer.saveFileBatch(fileBatch);
    }

    return indexedCount;
  } catch (error) {
    console.error(`Error indexing directory ${dirPath}:`, error);
    return 0;
  }
}

function copyFolderRecursiveSync(source, destination) {
  // Create destination folder if it doesn't exist
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  // Read all files and directories in the source folder
  const files = fs.readdirSync(source);

  // Process each file/directory
  for (const file of files) {
    const sourcePath = path.join(source, file);
    const destPath = path.join(destination, file);

    // Get file stats
    const stats = fs.statSync(sourcePath);

    if (stats.isDirectory()) {
      // Recursively copy subdirectories
      copyFolderRecursiveSync(sourcePath, destPath);
    } else {
      // Copy files
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

async function processFolderCover(fileDetail, filePath, baseDir) {
  try {
    const subFiles = await fs.promises.readdir(filePath);

    // parallel check file type
    const imageCheckPromises = subFiles.map(async subFile => {
      const subFilePath = path.join(filePath, subFile);
      try {
        const mimeType = await utils.getFileType(subFilePath);
        return { subFile, mimeType };
      } catch {
        return { subFile, mimeType: 'unknown' };
      }
    });

    const imageFiles = (await Promise.all(imageCheckPromises))
      .filter(({ mimeType }) => mimeType.startsWith('image/'))
      .map(({ subFile }) => subFile)
      .sort();

    if (imageFiles.length > 0) {
      fileDetail.cover = utils.normalizePath(
        path.join(baseDir, fileDetail.name, imageFiles[0])
      );
    }
  } catch (error) {
    console.error(`Error processing cover for ${filePath}:`, error);
  }
}

async function processPsdFile(psdPath) {
  if (!config.processPsd) {
    return null;
  }

  try {
    // Generate a hash of the file path and last modified time to create a unique cache key
    const stats = fs.statSync(psdPath);
    const hashInput = `${psdPath}-${stats.mtimeMs}`;
    const cacheKey = crypto.createHash('md5').update(hashInput).digest('hex');

    const outputPath = path.join(config.psdCacheDir, `${cacheKey}.png`);

    if (fs.existsSync(outputPath)) {
      return outputPath;
    }

    if (config.psdProcessor === 'imagemagick') {
      return await processWithImageMagick(psdPath, outputPath);
    } else {
      return await processWithPsdLibrary(psdPath, outputPath);
    }
  } catch (error) {
    console.error(`Error processing PSD file ${psdPath}: ${error.message}`);
    return null;
  }
}

// Process PSD file using ImageMagick
async function processWithImageMagick(psdPath, outputPath) {
  try {
    // Process the PSD file using ImageMagick (convert command) to PNG
    // Note: This requires ImageMagick to be installed on the system
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pngOutputPath = outputPath.replace(/\.[^.]+$/, '.png');
    // execSync(`magick "${psdPath}" "${pngOutputPath}"`);
    execSync(`magick "${psdPath}"[0] "${pngOutputPath}"`);

    if (fs.existsSync(pngOutputPath)) {
      return pngOutputPath;
    } else {
      console.error(`Failed to process PSD file with ImageMagick: ${psdPath} - Output file not created`);
      return null;
    }
  } catch (error) {
    console.error(`Error executing ImageMagick for PSD processing: ${error.message}`);
    return null;
  }
}

// Process PSD file using the psd library
async function processWithPsdLibrary(psdPath, outputPath) {
  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const pngOutputPath = outputPath.replace(/\.[^.]+$/, '.png');

    await PSD.open(psdPath).then(psd => {
      return psd.image.saveAsPng(pngOutputPath);
    });

    if (fs.existsSync(pngOutputPath)) {
      return pngOutputPath;
    } else {
      console.error(`Failed to process PSD file with psd library: ${psdPath} - Output file not created`);
      return null;
    }
  } catch (error) {
    console.error(`Error processing PSD with psd library: ${error.message}`);
    return null;
  }
}

// Helper function to sort files
function sortFiles(files, sortBy = 'name', sortOrder = 'asc') {
  return [...files].sort((a, b) => {
    // Always put directories first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    if (sortBy === 'name') {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return sortOrder === 'asc'
        ? collator.compare(a.name, b.name)
        : collator.compare(b.name, a.name);
    } else if (sortBy === 'path') {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      return sortOrder === 'asc'
        ? collator.compare(a.path, b.path)
        : collator.compare(b.path, a.path);
    } else if (sortBy === 'size') {
      return sortOrder === 'asc'
        ? a.size - b.size
        : b.size - a.size;
    } else if (sortBy === 'mtime') {
      const dateA = new Date(a.mtime).getTime();
      const dateB = new Date(b.mtime).getTime();
      return sortOrder === 'asc'
        ? dateA - dateB
        : dateB - dateA;
    }
    return 0;
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
