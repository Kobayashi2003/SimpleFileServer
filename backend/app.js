const config = require('./config')
const express = require('express');
const os = require('os');
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const cookieParser = require('cookie-parser');
const utils = require('./utils');

// handle file uploads
const multer = require('multer')
// indexer
const indexer = require('./indexer');
// watcher
const watcher = require('./watcher');
// C# indexer manager
const csharpIndexer = require('./csharp-indexer');
// auth
const { authMiddleware, writePermissionMiddleware } = require('./middleware/auth');
// logger
const { apiLoggingMiddleware } = require('./logger');
// worker threads
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// limit the concurrency of file read
const pLimit = require('p-limit').default;
const fileReadLimit = pLimit(100);

const authRoutes = require('./routes/auth')
const backgroundRoutes = require('./routes/background');
const contentRoutes = require('./routes/content')
const downloadRoutes = require('./routes/download');
const uploadRoutes = require('./routes/upload');


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

app.use('/api', backgroundRoutes);
app.use('/api', authRoutes);

app.use(authMiddleware);

// Initialize indexing and monitoring systems
if (config.useCSharpIndexer) {
  if (csharpIndexer.isAvailable()) {
    console.log('Using C# indexer for file indexing and monitoring...');
    
    // Start C# indexer
    csharpIndexer.start()
      .then(success => {
        if (success) {
          console.log('C# indexer started successfully');
          indexer.initializeDatabase();
          isIndexingEnabled = true;
        } else {
          console.error('Failed to start C# indexer');
          isIndexingEnabled = false;
        }
      })
      .catch(error => {
        console.error('Error starting C# indexer:', error.message);
        isIndexingEnabled = false;
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
  } else {
    console.error('C# indexer is enabled but executable not found');
    isIndexingEnabled = false;
  }
} else if (config.useFileIndex) {
  console.log('Using Node.js indexer...');
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
          isIndexingEnabled = true;
        } else {
          console.error('Failed to build file index:', result.message);
          isIndexingEnabled = false;
        }
      })
      .catch(error => {
        console.error('Error building file index:', error);
        isIndexingEnabled = false;
      });
  } else {
    const stats = indexer.getIndexStats();
    console.log(`Using existing file index with ${stats.fileCount} files, last built on ${stats.lastBuilt}`);
    isIndexingEnabled = true;
  }
} else {
  console.log('File indexing is disabled');
  isIndexingEnabled = false;
}

// Initialize Node.js file watcher only when Node.js indexer is enabled
if (!config.useCSharpIndexer && config.useFileIndex && config.useFileWatcher) {
  console.log('Initializing Node.js file watcher...');
  try {
    watcher.initialize() && watcher.startWatching(config.baseDirectory);
  } catch (error) {
    console.error('Error initializing file watcher:', error);
  } finally {
    console.log('File watcher initialized');
  }
}

// Helper function to check if indexing is available
function isIndexingAvailable() {
  if (config.useCSharpIndexer) {
    return csharpIndexer.isAvailable() && csharpIndexer.getStatus().isRunning && csharpIndexer.isDatabaseBuilt();
  } else if (config.useFileIndex) {
    return indexer.isIndexBuilt();
  }
  return false;
}

// Helper function to check if Node.js indexer should be updated on write operations
function shouldUpdateNodeIndexer() {
  return !config.useCSharpIndexer && config.useFileIndex && config.updateIndexOnWrite && indexer.isIndexBuilt();
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
    if (config.useFileIndexForFilesApi && isIndexingAvailable()) {
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
  const { query, dir = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = 'false', type } = req.query;
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  if (!query) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const isRecursive = recursive === 'true';

    // Use file index if enabled
    if (isIndexingAvailable()) {
      const searchResult = indexer.searchIndex(query, dir, page, limit, sortBy, sortOrder, isRecursive, type);
      return res.json(searchResult);
    }

    // Otherwise, use real-time search
    if (isRecursive) {
      // Use existing recursive search implementation
      parallelSearch(searchPath, query, basePath)
        .then(results => {
          // Filter by type if specified
          if (type && ['image', 'audio', 'video'].includes(type)) {
            results = results.filter(file => file.mimeType && file.mimeType.startsWith(type + '/'));
          }

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
          // Filter by type if specified
          if (type && ['image', 'audio', 'video'].includes(type)) {
            results = results.filter(file => file.mimeType && file.mimeType.startsWith(type + '/'));
          }

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
  if (!isIndexingAvailable()) {
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

app.use('/api', contentRoutes);
app.use('/api', downloadRoutes);
app.use('/api', uploadRoutes);

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
    if (shouldUpdateNodeIndexer()) {
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
    if (shouldUpdateNodeIndexer()) {
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
    if (shouldUpdateNodeIndexer()) {
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
    if (shouldUpdateNodeIndexer()) {
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
      if (shouldUpdateNodeIndexer()) {
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
          if (shouldUpdateNodeIndexer()) {
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
          if (shouldUpdateNodeIndexer()) {
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
    if (shouldUpdateNodeIndexer() && filesToIndex.length > 0) {
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
      if (shouldUpdateNodeIndexer()) {
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
        if (shouldUpdateNodeIndexer()) {
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

      // Update indexer before moving/deleting the file
      if (shouldUpdateNodeIndexer()) {
        indexer.deleteFromIndex(filePath);
        console.log(`Removed ${isDirectory ? 'directory' : 'file'} "${filePath}" from index`);
      }

      let success = false;
      let message = '';

      if (config.useRecycleBin) {
        // Move to recycle bin instead of deleting
        const result = moveToRecycleBin(fullPath, filePath);
        success = result.success;
        message = isDirectory 
          ? 'Directory moved to recycle bin successfully' 
          : 'File moved to recycle bin successfully';
        
        if (!success) {
          return res.status(500).json({ error: result.error || 'Failed to move to recycle bin' });
        }
      } else {
        // Original delete logic
        if (isDirectory) {
          success = utils.safeDeleteDirectory(fullPath);
          message = 'Directory deleted successfully';
          
          if (!success) {
            return res.status(500).json({ error: 'Failed to completely delete directory' });
          }
        } else {
          fs.unlinkSync(fullPath);
          success = true;
          message = 'File deleted successfully';
        }
      }

      res.status(200).json({ message });
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

        // Update indexer before moving/deleting the file
        if (shouldUpdateNodeIndexer()) {
          indexer.deleteFromIndex(relativePath);
        }

        if (config.useRecycleBin) {
          // Move to recycle bin instead of deleting
          const result = moveToRecycleBin(fullPath, relativePath);
          if (!result.success) {
            return res.status(500).json({ 
              error: result.error || 'Failed to move to recycle bin' 
            });
          }
        } else {
          // Original delete logic
          if (isDirectory) {
            const success = utils.safeDeleteDirectory(fullPath);
            if (!success) {
              return res.status(500).json({ error: 'Failed to completely delete directory' });
            }
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      } catch (error) {
        return res.status(500).json({ error: error.message });
      }
    }

    if (shouldUpdateNodeIndexer()) {
      console.log(`Removed ${fullPaths.length} items from index`);
    }

    const message = config.useRecycleBin 
      ? 'Files moved to recycle bin successfully' 
      : 'Files deleted successfully';
    res.status(200).json({ message });
  }
})

app.get('/api/recyclebin', authMiddleware, (req, res) => {
  if (!config.useRecycleBin) {
    return res.status(400).json({ error: "Recycle bin is not enabled" });
  }

  try {
    const recycleBinItems = fs.readdirSync(config.recycleBinDirectory);
    const items = [];
    let totalSize = 0;

    // Process all items except metadata files
    recycleBinItems.forEach(item => {
      if (item.endsWith('.meta.json')) return;

      const itemPath = path.join(config.recycleBinDirectory, item);
      const metadataPath = `${itemPath}.meta.json`;

      try {
        const stats = fs.statSync(itemPath);
        const isDirectory = stats.isDirectory();
        
        // Calculate item size
        const size = isDirectory ? calculateDirectorySize(itemPath) : stats.size;
        totalSize += size;
        
        // Get metadata if available
        let metadata = null;
        let originalPath = null;
        let deletedAt = null;
        let expiresAt = null;

        if (fs.existsSync(metadataPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
            originalPath = metadata.originalPath;
            deletedAt = metadata.deletedAt;
            expiresAt = metadata.expiresAt;
          } catch (error) {
            console.error(`Error reading metadata for ${item}: ${error.message}`);
          }
        }

        items.push({
          id: item,
          name: originalPath ? path.basename(originalPath) : item.substring(item.indexOf('_') + 1),
          originalPath,
          deletedAt,
          expiresAt,
          size,
          isDirectory
        });
      } catch (error) {
        console.error(`Error processing recycle bin item ${item}: ${error.message}`);
      }
    });

    // Sort by deletion date (newest first)
    items.sort((a, b) => {
      if (a.deletedAt && b.deletedAt) {
        return new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime();
      }
      return 0;
    });

    res.json({
      items,
      totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      maxSizeMB: config.recycleBinMaxSize,
      retentionDays: config.recycleBinRetentionDays,
      autoCleanup: config.recycleBinAutoCleanup
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/recyclebin/restore', writePermissionMiddleware, async (req, res) => {
  if (!config.useRecycleBin) {
    return res.status(400).json({ error: "Recycle bin is not enabled" });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "No item ID provided" });
  }

  try {
    const itemPath = path.join(config.recycleBinDirectory, id);
    const metadataPath = `${itemPath}.meta.json`;

    if (!fs.existsSync(itemPath)) {
      return res.status(404).json({ error: "Item not found in recycle bin" });
    }

    // Get original path from metadata
    let originalPath = null;
    if (fs.existsSync(metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        originalPath = metadata.originalPath;
      } catch (error) {
        console.error(`Error reading metadata for ${id}: ${error.message}`);
      }
    }

    // If no original path found, can't restore
    if (!originalPath) {
      return res.status(400).json({ error: "Original path information not found, cannot restore" });
    }

    const basePath = path.resolve(config.baseDirectory);
    const targetPath = path.join(basePath, originalPath);
    const targetDir = path.dirname(targetPath);

    // Create target directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Check if target already exists
    if (fs.existsSync(targetPath)) {
      return res.status(409).json({ error: "Target path already exists. Cannot restore." });
    }

    const isDirectory = fs.statSync(itemPath).isDirectory();

    // Restore the file or directory
    if (isDirectory) {
      // For directories, copy recursively
      copyFolderRecursiveSync(itemPath, targetPath);
    } else {
      // For files, just copy
      fs.copyFileSync(itemPath, targetPath);
    }

    // Update the indexer if enabled
    if (shouldUpdateNodeIndexer()) {
      try {
        // If it's a directory, we need to index it and its contents
        if (isDirectory) {
          const stats = fs.statSync(targetPath);
          
          // Add the directory itself
          indexer.saveFileBatch([{
            name: path.basename(originalPath),
            path: originalPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
          }]);
          
          // Index directory contents
          indexDirectoryRecursively(targetPath, basePath)
            .then(count => {
              console.log(`Indexed ${count} items in restored directory ${originalPath}`);
            })
            .catch(err => {
              console.error(`Error indexing restored directory: ${err.message}`);
            });
        } else {
          // For files, just add the file
          const stats = fs.statSync(targetPath);
          const mimeType = await utils.getFileType(targetPath);
          
          indexer.saveFileBatch([{
            name: path.basename(originalPath),
            path: originalPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: mimeType,
            isDirectory: false
          }]);
        }
      } catch (error) {
        console.error(`Error updating index for restored item: ${error.message}`);
      }
    }

    // Delete the item from recycle bin
    if (isDirectory) {
      utils.safeDeleteDirectory(itemPath);
    } else {
      fs.unlinkSync(itemPath);
    }

    // Delete metadata file
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }

    res.json({ 
      message: `${isDirectory ? 'Directory' : 'File'} restored successfully to ${originalPath}`,
      restoredTo: originalPath 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/recyclebin/delete', writePermissionMiddleware, (req, res) => {
  if (!config.useRecycleBin) {
    return res.status(400).json({ error: "Recycle bin is not enabled" });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "No item ID provided" });
  }

  try {
    const itemPath = path.join(config.recycleBinDirectory, id);
    const metadataPath = `${itemPath}.meta.json`;

    if (!fs.existsSync(itemPath)) {
      return res.status(404).json({ error: "Item not found in recycle bin" });
    }

    const isDirectory = fs.statSync(itemPath).isDirectory();

    // Delete the item
    let success = false;
    if (isDirectory) {
      success = utils.safeDeleteDirectory(itemPath);
      if (!success) {
        return res.status(500).json({ error: "Failed to delete directory from recycle bin" });
      }
    } else {
      fs.unlinkSync(itemPath);
      success = true;
    }

    // Delete metadata file
    if (fs.existsSync(metadataPath)) {
      fs.unlinkSync(metadataPath);
    }

    res.json({ message: `${isDirectory ? 'Directory' : 'File'} permanently deleted from recycle bin` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/recyclebin/empty', writePermissionMiddleware, (req, res) => {
  if (!config.useRecycleBin) {
    return res.status(400).json({ error: "Recycle bin is not enabled" });
  }

  try {
    const recycleBinItems = fs.readdirSync(config.recycleBinDirectory);
    let deletedCount = 0;
    let errorCount = 0;

    // Process all items except metadata files
    recycleBinItems.forEach(item => {
      if (item.endsWith('.meta.json')) return;

      const itemPath = path.join(config.recycleBinDirectory, item);
      const metadataPath = `${itemPath}.meta.json`;

      try {
        const isDirectory = fs.statSync(itemPath).isDirectory();

        // Delete the item
        if (isDirectory) {
          const success = utils.safeDeleteDirectory(itemPath);
          if (success) {
            deletedCount++;
          } else {
            errorCount++;
          }
        } else {
          fs.unlinkSync(itemPath);
          deletedCount++;
        }

        // Delete metadata file
        if (fs.existsSync(metadataPath)) {
          fs.unlinkSync(metadataPath);
        }
      } catch (error) {
        console.error(`Error deleting recycle bin item ${item}: ${error.message}`);
        errorCount++;
      }
    });

    // Delete any orphaned metadata files
    recycleBinItems.forEach(item => {
      if (item.endsWith('.meta.json')) {
        try {
          fs.unlinkSync(path.join(config.recycleBinDirectory, item));
        } catch (error) {
          console.error(`Error deleting orphaned metadata file ${item}: ${error.message}`);
        }
      }
    });

    res.json({ 
      message: `Recycle bin emptied successfully`,
      deletedCount,
      errorCount
    });
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
      ...status
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


function handleMediaFilesRequest(req, res, mediaType, isRecursive, dir, page, limit, sortBy, sortOrder) {
  const basePath = path.resolve(config.baseDirectory);
  const searchPath = path.join(basePath, dir);

  if (!searchPath.startsWith(basePath)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    // Use file index if enabled
    if (isIndexingAvailable()) {
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

      // if (file.toLowerCase().includes(query.toLowerCase())) {
      if (path.basename(file).toLowerCase().includes(query.toLowerCase())) {
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

      // if (file.toLowerCase().includes(query.toLowerCase())) {
      if (path.basename(file).toLowerCase().includes(query.toLowerCase())) {
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
  if (!shouldUpdateNodeIndexer()) return 0;

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

// Helper function to move file to recycle bin
async function moveToRecycleBin(sourcePath, relativePath) {
  try {
    // Generate a unique filename to prevent collisions in the recycle bin
    const timestamp = new Date().toISOString().replace(/[:.-]/g, '_');
    const originalName = path.basename(sourcePath);
    const recyclePath = path.join(
      config.recycleBinDirectory,
      `${timestamp}_${originalName}`
    );
    
    // Create recycle bin metadata to track original path and deletion time
    const metadata = {
      originalPath: relativePath,
      deletedAt: new Date().toISOString(),
      expiresAt: config.recycleBinRetentionDays > 0 
        ? new Date(Date.now() + config.recycleBinRetentionDays * 24 * 60 * 60 * 1000).toISOString()
        : null
    };
    
    const isDirectory = fs.statSync(sourcePath).isDirectory();
    
    if (isDirectory) {
      // For directories, we need to copy the directory structure
      copyFolderRecursiveSync(sourcePath, recyclePath);
      
      // Save metadata alongside the directory
      fs.writeFileSync(
        `${recyclePath}.meta.json`, 
        JSON.stringify(metadata, null, 2)
      );
      
      // Remove the original directory after successful copy
      utils.safeDeleteDirectory(sourcePath);
      return { success: true, recyclePath };
    } else {
      // For files, just move the file
      fs.mkdirSync(path.dirname(recyclePath), { recursive: true });
      fs.copyFileSync(sourcePath, recyclePath);
      
      // Save metadata alongside the file
      fs.writeFileSync(
        `${recyclePath}.meta.json`, 
        JSON.stringify(metadata, null, 2)
      );
      
      // Remove the original file after successful copy
      fs.unlinkSync(sourcePath);
      return { success: true, recyclePath };
    }
  } catch (error) {
    console.error(`Error moving to recycle bin: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Helper function to clean up old items in recycle bin
function cleanupRecycleBin() {
  if (!config.recycleBinAutoCleanup) {
    return;
  }
  
  try {
    const recycleBinItems = fs.readdirSync(config.recycleBinDirectory);
    const now = Date.now();
    let recycleBinSize = 0;
    const itemsWithMetadata = [];
    
    // First pass: collect metadata and calculate total size
    recycleBinItems.forEach(item => {
      // Skip metadata files, we'll process them with their corresponding items
      if (item.endsWith('.meta.json')) return;
      
      const itemPath = path.join(config.recycleBinDirectory, item);
      const metadataPath = `${itemPath}.meta.json`;
      
      try {
        // Get item stats
        const stats = fs.statSync(itemPath);
        const isDirectory = stats.isDirectory();
        let itemSize = 0;
        
        if (isDirectory) {
          // For directories, calculate recursive size
          itemSize = calculateDirectorySize(itemPath);
        } else {
          // For files, use the file size
          itemSize = stats.size;
        }
        
        // Add to total size (convert to MB)
        recycleBinSize += itemSize / (1024 * 1024);
        
        // Collect item info with metadata
        let metadata = null;
        if (fs.existsSync(metadataPath)) {
          try {
            metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          } catch (error) {
            console.error(`Error reading metadata for ${item}: ${error.message}`);
          }
        }
        
        itemsWithMetadata.push({
          name: item,
          path: itemPath,
          metadataPath,
          isDirectory,
          size: itemSize,
          mtime: stats.mtimeMs,
          metadata
        });
      } catch (error) {
        console.error(`Error processing recycle bin item ${item}: ${error.message}`);
      }
    });
    
    // Age-based cleanup: remove items older than retention days
    if (config.recycleBinRetentionDays > 0) {
      const maxAge = config.recycleBinRetentionDays * 24 * 60 * 60 * 1000;
      
      itemsWithMetadata.forEach(item => {
        let shouldDelete = false;
        
        // Check expiry based on metadata first
        if (item.metadata && item.metadata.expiresAt) {
          const expiryTime = new Date(item.metadata.expiresAt).getTime();
          if (now > expiryTime) {
            shouldDelete = true;
          }
        } else {
          // Fallback to file modification time
          const fileAge = now - item.mtime;
          if (fileAge > maxAge) {
            shouldDelete = true;
          }
        }
        
        if (shouldDelete) {
          try {
            // Delete the item
            if (item.isDirectory) {
              utils.safeDeleteDirectory(item.path);
            } else {
              fs.unlinkSync(item.path);
            }
            
            // Delete the metadata file if it exists
            if (fs.existsSync(item.metadataPath)) {
              fs.unlinkSync(item.metadataPath);
            }
            
            console.log(`Removed expired item from recycle bin: ${item.name}`);
            
            // Update recycle bin size
            recycleBinSize -= item.size / (1024 * 1024);
          } catch (error) {
            console.error(`Error deleting expired item ${item.name}: ${error.message}`);
          }
        }
      });
    }
    
    // Size-based cleanup: remove oldest items if bin is too large
    if (config.recycleBinMaxSize > 0 && recycleBinSize > config.recycleBinMaxSize) {
      console.log(`Recycle bin size (${recycleBinSize.toFixed(2)} MB) exceeds maximum (${config.recycleBinMaxSize} MB), cleaning up...`);
      
      // Sort items by deletion time (oldest first)
      const remainingItems = itemsWithMetadata.filter(item => {
        // Only consider items that still exist (weren't removed in age-based cleanup)
        return fs.existsSync(item.path);
      }).sort((a, b) => {
        // Sort by metadata deletion time if available
        if (a.metadata?.deletedAt && b.metadata?.deletedAt) {
          return new Date(a.metadata.deletedAt).getTime() - new Date(b.metadata.deletedAt).getTime();
        }
        // Fallback to file modification time
        return a.mtime - b.mtime;
      });
      
      // Remove oldest items until we're under the size limit
      while (recycleBinSize > config.recycleBinMaxSize && remainingItems.length > 0) {
        const oldestItem = remainingItems.shift();
        try {
          // Delete the item
          if (oldestItem.isDirectory) {
            utils.safeDeleteDirectory(oldestItem.path);
          } else {
            fs.unlinkSync(oldestItem.path);
          }
          
          // Delete the metadata file if it exists
          if (fs.existsSync(oldestItem.metadataPath)) {
            fs.unlinkSync(oldestItem.metadataPath);
          }
          
          console.log(`Removed oldest item from recycle bin due to size limit: ${oldestItem.name}`);
          
          // Update recycle bin size
          recycleBinSize -= oldestItem.size / (1024 * 1024);
        } catch (error) {
          console.error(`Error deleting oldest item ${oldestItem.name}: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error cleaning up recycle bin: ${error.message}`);
  }
}

// Helper function to calculate directory size recursively
function calculateDirectorySize(directoryPath) {
  let totalSize = 0;
  
  try {
    const items = fs.readdirSync(directoryPath);
    
    for (const item of items) {
      const itemPath = path.join(directoryPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        // Recursively calculate subdirectory size
        totalSize += calculateDirectorySize(itemPath);
      } else {
        // Add file size
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating directory size for ${directoryPath}: ${error.message}`);
  }
  
  return totalSize;
}

// Run cleanup on startup and periodically
if (config.recycleBinAutoCleanup && config.recycleBinRetentionDays > 0) {
  // Initial cleanup
  cleanupRecycleBin();
  
  // Schedule periodic cleanup (daily)
  setInterval(cleanupRecycleBin, 24 * 60 * 60 * 1000);
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
