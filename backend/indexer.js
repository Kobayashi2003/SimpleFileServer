const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const utils = require('./utils');

const Database = require('better-sqlite3');

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SQL = {
  CREATE_FILES_TABLE: `
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      size INTEGER NOT NULL,
      mtime TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      isDirectory INTEGER NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
    CREATE INDEX IF NOT EXISTS idx_files_mimeType ON files(mimeType);
    CREATE INDEX IF NOT EXISTS idx_files_isDirectory ON files(isDirectory);
  `,
  CREATE_METADATA_TABLE: `
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `,

  GET_LAST_BUILT: "SELECT value FROM metadata WHERE key = 'last_built'",
  GET_BASE_DIRECTORY: "SELECT value FROM metadata WHERE key = 'base_directory'",
  UPDATE_METADATA: 'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',

  COUNT_FILES: 'SELECT COUNT(*) as count FROM files',
  INSERT_FILE: `
  INSERT OR REPLACE INTO files (name, path, size, mtime, mimeType, isDirectory) 
  VALUES (?, ?, ?, ?, ?, ?)
  `,
  // SEARCH_FILES: `
  // SELECT name, path, size, mtime, mimeType, isDirectory 
  // FROM files 
  // WHERE (name LIKE ? OR path LIKE ?) 
  // AND (? = '%' OR path LIKE ?)
  // `,
  // SEARCH_FILES_COUNT: `
  // SELECT COUNT(*) as count 
  // FROM files 
  // WHERE (name LIKE ? OR path LIKE ?) 
  // AND (? = '%' OR path LIKE ?)
  // `,
  // SEARCH_FILES_NON_RECURSIVE: `
  // SELECT name, path, size, mtime, mimeType, isDirectory 
  // FROM files 
  // WHERE (name LIKE ? OR path LIKE ?) 
  // AND (? = '%' OR path LIKE ?)
  // AND (? IS NULL OR path NOT LIKE ?)
  // `,
  // SEARCH_FILES_COUNT_NON_RECURSIVE: `
  // SELECT COUNT(*) as count 
  // FROM files 
  // WHERE (name LIKE ? OR path LIKE ?) 
  // AND (? = '%' OR path LIKE ?) 
  // AND (? IS NULL OR path NOT LIKE ?)
  // `,
  SEARCH_FILES: `
  SELECT name, path, size, mtime, mimeType, isDirectory 
  FROM files 
  WHERE name LIKE ? 
  AND (? = '%' OR path LIKE ?)
  `,
  SEARCH_FILES_COUNT: `
  SELECT COUNT(*) as count 
  FROM files 
  WHERE name LIKE ? 
  AND (? = '%' OR path LIKE ?)
  `,
  SEARCH_FILES_NON_RECURSIVE: `
  SELECT name, path, size, mtime, mimeType, isDirectory 
  FROM files 
  WHERE name LIKE ? 
  AND (? = '%' OR path LIKE ?)
  AND (? IS NULL OR path NOT LIKE ?)
  `,
  SEARCH_FILES_COUNT_NON_RECURSIVE: `
  SELECT COUNT(*) as count 
  FROM files 
  WHERE name LIKE ? 
  AND (? = '%' OR path LIKE ?) 
  AND (? IS NULL OR path NOT LIKE ?)
  `,
  DELETE_FILE: 'DELETE FROM files WHERE path = ?',
  DELETE_FILE_PREFIX: 'DELETE FROM files WHERE path LIKE ?',
  DELETE_ALL_FILES: 'DELETE FROM files',
  GET_DIRECTORY_FILES: `
  SELECT name, path, size, mtime, mimeType, isDirectory 
  FROM files 
  WHERE path LIKE ? AND path NOT LIKE ?
  `,
  COUNT_DIRECTORY_FILES: `
  SELECT COUNT(*) as count 
  FROM files 
  WHERE path LIKE ? AND path NOT LIKE ?
  `,
};

let db = null;
let isIndexBuilding = false;
let indexProgress = {
  total: 0,
  processed: 0,
  errors: 0,
  startTime: null,
  lastUpdated: null,
};

// MIME type cache with size limit
class LimitedSizeCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  has(key) {
    return this.cache.has(key);
  }

  get(key) {
    return this.cache.get(key);
  }

  set(key, value) {
    // If cache is full, remove oldest entry (first item in map)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear() {
    this.cache.clear();
  }
}

// Create a limited size MIME type cache
const mimeTypeCache = new LimitedSizeCache(5000);

// Internal concurrency limiter
function createConcurrencyLimiter(limit) {
  const queue = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      run(fn).then(resolve).catch(reject);
    }
  };

  const run = async (fn) => {
    activeCount++;
    try {
      return await fn();
    } finally {
      next();
    }
  };

  return (fn) => {
    return new Promise((resolve, reject) => {
      if (activeCount < limit) {
        run(fn).then(resolve).catch(reject);
      } else {
        queue.push({ fn, resolve, reject });
      }
    });
  };
}

// Database initialization
function initializeDatabase() {
  if (db) return;

  try {
    db = new Database(config.fileIndexPath);
    db.exec(SQL.CREATE_FILES_TABLE);
    db.exec(SQL.CREATE_METADATA_TABLE);

    console.log('Database initialized at', config.fileIndexPath);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

function isIndexBuilt() {
  if (!db) return false;

  try {
    // Check if the index has been built by looking for 'last_built' metadata
    const result = db.prepare(SQL.GET_LAST_BUILT).get();
    const lastBuilt = result && result.value !== null;

    // Check if base directory matches
    const baseDirectoryResult = db.prepare(SQL.GET_BASE_DIRECTORY).get();
    const baseDirectoryMatches = baseDirectoryResult && baseDirectoryResult.value === config.baseDirectory;

    // Index is considered built only if both conditions are met
    return lastBuilt && baseDirectoryMatches;
  } catch (error) {
    console.error('Error checking if index is built:', error);
    return false;
  }
}

function getIndexStats() {
  if (!db) {
    return {
      fileCount: 0,
      lastBuilt: null,
      isBuilding: isIndexBuilding,
      progress: indexProgress
    };
  }

  try {
    const fileCount = db.prepare(SQL.COUNT_FILES).get().count;
    const lastBuiltRow = db.prepare(SQL.GET_LAST_BUILT).get();
    const lastBuilt = lastBuiltRow ? lastBuiltRow.value : null;

    return {
      fileCount,
      lastBuilt,
      isBuilding: isIndexBuilding,
      progress: indexProgress
    };
  } catch (error) {
    console.error('Error getting index stats:', error);
    return {
      fileCount: 0,
      lastBuilt: null,
      isBuilding: isIndexBuilding,
      progress: indexProgress
    };
  }
}

function clearIndex() {
  if (!db) return false;

  try {
    db.prepare(SQL.DELETE_ALL_FILES).run();
    // Clear all metadata
    db.prepare(SQL.UPDATE_METADATA).run('last_built', null);
    db.prepare(SQL.UPDATE_METADATA).run('base_directory', null);
    console.log('Index cleared');
    return true;
  } catch (error) {
    console.error('Error clearing index:', error);
    return false;
  }
}

function deleteFromIndex(filePath) {
  if (!db) return false;

  try {
    // Check if this is a directory
    if (filePath.endsWith('/') || fs.existsSync(path.join(config.baseDirectory, filePath)) &&
      fs.statSync(path.join(config.baseDirectory, filePath)).isDirectory()) {
      // If it's a directory, delete all files with this path prefix
      const pathPrefix = filePath.endsWith('/') ? filePath : `${filePath}/`;
      const result = db.prepare(SQL.DELETE_FILE_PREFIX).run(`${pathPrefix}%`);

      // Also delete the directory entry itself
      const dirResult = db.prepare(SQL.DELETE_FILE).run(filePath);

      if (result.changes > 0 || dirResult.changes > 0) {
        console.log(`Removed ${filePath} and all contents from index`);
        return true;
      }
    } else {
      // Regular file deletion
      const result = db.prepare(SQL.DELETE_FILE).run(filePath);
      if (result.changes > 0) {
        console.log(`Removed ${filePath} from index`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error deleting file from index:', error);
    return false;
  }
}


function searchIndex(query, directory = '', page, limit, sortBy = 'name', sortOrder = 'asc', recursive = true, type = null) {
  if (!db) return { results: [], total: 0, hasMore: false };

  try {
    const searchTerm = `%${query}%`;
    let dirPath, excludePattern;

    if (recursive) {
      // Recursive search - use existing behavior
      dirPath = directory ? `${directory}%` : '%';
      excludePattern = null; // No exclusion pattern for recursive search
    } else {
      // Non-recursive search - only search in the specified directory
      if (directory === '') {
        // Root directory: match paths without slashes (top-level files and folders)
        dirPath = '%';
        excludePattern = '%/%'; // exclude paths with slashes (subdirectory contents)
      } else {
        // Subdirectory: match direct subfiles and subfolders
        const normalizedPath = directory.endsWith('/') ? directory : `${directory}/`;
        dirPath = `${normalizedPath}%`;
        excludePattern = `${normalizedPath}%/%`; // exclude deeper paths
      }
    }

    // Build file type condition
    let typeCondition = '';
    let typeParams = [];
    if (type && ['image', 'audio', 'video'].includes(type)) {
      typeCondition = " AND mimeType LIKE ?";
      typeParams = [`${type}/%`];
    }

    // Prepare the SQL count query based on recursive flag
    let countSql, countParams;
    if (recursive) {
      countSql = SQL.SEARCH_FILES_COUNT + typeCondition;
      // countParams = [searchTerm, searchTerm, dirPath, dirPath, ...typeParams];
      countParams = [searchTerm, dirPath, dirPath, ...typeParams];
    } else {
      countSql = SQL.SEARCH_FILES_COUNT_NON_RECURSIVE + typeCondition;
      // countParams = [searchTerm, dirPath, dirPath, excludePattern, excludePattern, ...typeParams];
      countParams = [searchTerm, dirPath, dirPath, ...typeParams];
    }

    // Get total count for pagination info
    const totalCount = db.prepare(countSql).get(...countParams).count;

    let results;
    let hasMore = false;

    // Handle pagination if specified
    if (page !== undefined && limit !== undefined) {
      // Convert to numbers and validate
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;

      // Calculate offset
      const offset = (pageNum - 1) * limitNum;

      // Prepare the paginated query based on recursive flag
      let paginatedQuery;
      if (recursive) {
        paginatedQuery = `${SQL.SEARCH_FILES} ${typeCondition} `;
      } else {
        paginatedQuery = `${SQL.SEARCH_FILES_NON_RECURSIVE} ${typeCondition} `;
      }

      // Add ordering based on sortBy and sortOrder parameters
      paginatedQuery += getOrderByClause(sortBy, sortOrder);

      // Add pagination
      paginatedQuery += ` LIMIT ? OFFSET ?`;

      if (recursive) {
        results = db.prepare(paginatedQuery)
          // .all(searchTerm, searchTerm, dirPath, dirPath, ...typeParams, limitNum, offset);
          .all(searchTerm, dirPath, dirPath, ...typeParams, limitNum, offset);
      } else {
        results = db.prepare(paginatedQuery)
          // .all(searchTerm, searchTerm, dirPath, dirPath, excludePattern, excludePattern, ...typeParams, limitNum, offset);
          .all(searchTerm, dirPath, dirPath, excludePattern, excludePattern, ...typeParams, limitNum, offset);
      }

      // Check if there are more results
      hasMore = offset + results.length < totalCount;
    } else {
      // Backward compatibility: return all results if no pagination specified
      let fullQuery;
      if (recursive) {
        fullQuery = `${SQL.SEARCH_FILES} ${typeCondition} `;
      } else {
        fullQuery = `${SQL.SEARCH_FILES_NON_RECURSIVE} ${typeCondition} `;
      }

      // Add ordering based on sortBy and sortOrder parameters
      fullQuery += getOrderByClause(sortBy, sortOrder);

      if (recursive) {
        results = db.prepare(fullQuery)
          // .all(searchTerm, searchTerm, dirPath, dirPath, ...typeParams);
          .all(searchTerm, dirPath, dirPath, ...typeParams);
      } else {
        results = db.prepare(fullQuery)
          // .all(searchTerm, searchTerm, dirPath, dirPath, excludePattern, excludePattern, ...typeParams);
          .all(searchTerm, dirPath, dirPath, excludePattern, excludePattern, ...typeParams);
      }
    }

    return {
      results: results.map(file => ({
        ...file,
        mtime: new Date(file.mtime),
        isDirectory: !!file.isDirectory
      })),
      total: totalCount,
      hasMore
    };
  } catch (error) {
    console.error('Error searching index:', error);
    return { results: [], total: 0, hasMore: false };
  }
}

/**
 * Generic function to find files in index
 * @param {string} directory - Base directory to search in
 * @param {string} fileType - Type of files to find ('image'|'video'|'audio'|'all')
 * @param {object} options - Search options
 * @returns {object} Files, total count and pagination info
 */
function findFilesInIndex(directory = '', fileType = 'all', options = {}) {
  const {
    page,
    limit,
    sortBy = 'name',
    sortOrder = 'asc',
    recursive = true
  } = options;

  if (!db) return { files: [], total: 0, hasMore: false };

  try {
    // Prepare directory path and exclude pattern based on recursive option
    let dirPath, excludePattern;
    if (recursive) {
      dirPath = directory ? `${directory}%` : '%';
      excludePattern = null;
    } else {
      if (directory === '') {
        dirPath = '%';
        excludePattern = '%/%';
      } else {
        const normalizedPath = directory.endsWith('/') ? directory : `${directory}/`;
        dirPath = `${normalizedPath}%`;
        excludePattern = `${normalizedPath}%/%`;
      }
    }

    // Build file type condition
    let fileTypeCondition = '';
    switch (fileType) {
      case 'image':
        fileTypeCondition = "AND mimeType LIKE 'image/%'";
        break;
      case 'video':
        fileTypeCondition = "AND mimeType LIKE 'video/%'";
        break;
      case 'audio':
        fileTypeCondition = "AND mimeType LIKE 'audio/%'";
        break;
      default:
        fileTypeCondition = '';
    }

    // Build count query
    const countSql = recursive
      ? `SELECT COUNT(*) as count FROM files WHERE path LIKE ? ${fileTypeCondition}`
      : `SELECT COUNT(*) as count FROM files WHERE path LIKE ? ${fileTypeCondition} AND path NOT LIKE ?`;

    // Get total count
    const countParams = recursive ? [dirPath] : [dirPath, excludePattern];
    const totalCount = db.prepare(countSql).get(...countParams).count;

    // Build main query
    let mainQuery = recursive
      ? `SELECT * FROM files WHERE path LIKE ? ${fileTypeCondition}`
      : `SELECT * FROM files WHERE path LIKE ? ${fileTypeCondition} AND path NOT LIKE ?`;

    // Add sorting
    mainQuery += ` ORDER BY ${sortBy === 'name' ? 'path' : sortBy} ${sortOrder.toUpperCase()}`;

    // Add pagination if specified
    let queryParams = recursive ? [dirPath] : [dirPath, excludePattern];
    let hasMore = false;

    if (page !== undefined && limit !== undefined) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;
      const offset = (pageNum - 1) * limitNum;

      mainQuery += ' LIMIT ? OFFSET ?';
      queryParams.push(limitNum, offset);
      hasMore = offset + limitNum < totalCount;
    }

    // Execute query
    const results = db.prepare(mainQuery).all(...queryParams);

    return {
      files: results.map(file => ({
        ...file,
        mtime: new Date(file.mtime),
        isDirectory: !!file.isDirectory
      })),
      total: totalCount,
      hasMore
    };
  } catch (error) {
    console.error('Error finding files in index:', error);
    return { files: [], total: 0, hasMore: false };
  }
}

/**
 * Generic function to find media files in index
 * @param {string} directory - Base directory to search in
 * @param {string} mediaType - Type of media ('image'|'video'|'audio')
 * @param {object} options - Search options
 * @returns {object} Media files, total count and pagination info
 */
function findMediaInIndex(directory = '', mediaType = 'image', options = {}) {
  const {
    page,
    limit = 100,
    sortBy = 'name',
    sortOrder = 'asc',
    recursive = true
  } = options;

  if (!db) return { files: [], total: 0, hasMore: false };

  try {
    // Prepare directory path and exclude pattern based on recursive option
    let dirPath, excludePattern;
    if (recursive) {
      dirPath = directory ? `${directory}%` : '%';
      excludePattern = null;
    } else {
      dirPath = directory;
      excludePattern = directory ? `${directory}/%` : '%/%';
    }

    // Build media type condition
    let mimeTypeCondition;
    switch (mediaType) {
      case 'image':
        mimeTypeCondition = "mimeType LIKE 'image/%'";
        break;
      case 'video':
        mimeTypeCondition = "mimeType LIKE 'video/%'";
        break;
      case 'audio':
        mimeTypeCondition = "mimeType LIKE 'audio/%'";
        break;
      default:
        throw new Error('Invalid media type');
    }

    // Build query conditions
    const conditions = [
      "isDirectory = 0",
      mimeTypeCondition,
      directory ? "path LIKE ?" : "path NOT LIKE '/%'"
    ];

    if (!recursive && excludePattern) {
      conditions.push("path NOT LIKE ?");
    }

    // Build query
    const query = `
      SELECT *
      FROM files
      WHERE ${conditions.join(" AND ")}
      ${getOrderByClause(sortBy, sortOrder)}
      ${page ? `LIMIT ${limit} OFFSET ${(page - 1) * limit}` : ""}
    `;

    // Prepare query parameters
    const params = directory ? [dirPath] : [];
    if (!recursive && excludePattern) {
      params.push(excludePattern);
    }

    // Execute query
    const files = db.prepare(query).all(...params);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as count
      FROM files
      WHERE ${conditions.join(" AND ")}
    `;
    const { count } = db.prepare(countQuery).get(...params);

    // Calculate if there are more results
    const hasMore = page ? (page * limit) < count : false;

    return {
      files,
      total: count,
      hasMore
    };
  } catch (error) {
    console.error('Error finding media in index:', error);
    return { files: [], total: 0, hasMore: false };
  }
}

/**
 * Find images in index
 */
function findImagesInIndex(directory = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = true) {
  const result = findMediaInIndex(directory, 'image', {
    page, limit, sortBy, sortOrder, recursive
  });
  return {
    images: result.files,
    total: result.total,
    hasMore: result.hasMore
  };
}

/**
 * Find videos in index
 */
function findVideosInIndex(directory = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = true) {
  const result = findMediaInIndex(directory, 'video', {
    page, limit, sortBy, sortOrder, recursive
  });
  return {
    videos: result.files,
    total: result.total,
    hasMore: result.hasMore
  };
}

/**
 * Find audios in index
 */
function findAudiosInIndex(directory = '', page, limit = 100, sortBy = 'name', sortOrder = 'asc', recursive = true) {
  const result = findMediaInIndex(directory, 'audio', {
    page, limit, sortBy, sortOrder, recursive
  });
  return {
    audios: result.files,
    total: result.total,
    hasMore: result.hasMore
  };
}

function getOrderByClause(sortBy = 'name', sortOrder = 'asc') {
  // Validate sortBy to prevent SQL injection
  const validSortFields = ['name', 'path', 'size', 'mtime'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';

  // Validate sortOrder to prevent SQL injection
  const order = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  // Always list directories first, then sort by the specified field
  return `ORDER BY isDirectory DESC, ${sortField} ${order}`;
}

async function getDirectoryFiles(directory = '', page, limit, sortBy = 'name', sortOrder = 'asc', includeCover = false) {
  if (!db) return { files: [], total: 0, hasMore: false };

  try {
    const dirPath = directory ? directory : '';

    // build sql query params
    // 1. if root directory, find all top-level files and folders
    // 2. if subdirectory, find all direct subfiles and subfolders
    let pathPattern, excludePattern;

    if (dirPath === '') {
      // root directory: match paths without slashes (top-level files and folders)
      pathPattern = '%';
      excludePattern = '%/%'; // exclude paths with slashes (subdirectory contents)
    } else {
      // subdirectory: match direct subfiles and subfolders
      const normalizedPath = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
      pathPattern = `${normalizedPath}%`;
      excludePattern = `${normalizedPath}%/%`; // exclude deeper paths
    }

    const totalCount = db.prepare(SQL.COUNT_DIRECTORY_FILES)
      .get(pathPattern, excludePattern).count;

    // handle pagination
    let files;
    let hasMore = false;

    if (page !== undefined) {
      // convert to number and validate
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;

      // calculate offset
      const offset = (pageNum - 1) * limitNum;

      // query with pagination and sorting
      let paginatedQuery = `${SQL.GET_DIRECTORY_FILES} `;

      // add sorting condition
      paginatedQuery += getOrderByClause(sortBy, sortOrder);

      // add pagination
      paginatedQuery += ` LIMIT ? OFFSET ?`;

      files = db.prepare(paginatedQuery)
        .all(pathPattern, excludePattern, limitNum, offset);

      // check if there are more results
      hasMore = offset + files.length < totalCount;
    } else {
      // query without pagination
      let fullQuery = `${SQL.GET_DIRECTORY_FILES} `;

      // add sorting condition
      fullQuery += getOrderByClause(sortBy, sortOrder);

      files = db.prepare(fullQuery)
        .all(pathPattern, excludePattern);
    }

    // convert isDirectory to boolean
    const result = files.map(file => ({
      ...file,
      isDirectory: !!file.isDirectory,
      mtime: new Date(file.mtime) // convert to date object to match original API
    }));

    // if need to get directory cover
    if (includeCover && result.length > 0) {
      await addDirectoryCovers(result, dirPath);
    }

    return {
      files: result,
      total: totalCount,
      hasMore
    };
  } catch (error) {
    console.error('Error getting directory files from index:', error);
    return { files: [], total: 0, hasMore: false };
  }
}

async function addDirectoryCovers(files, parentDir) {
  // only process directory type files
  const directories = files.filter(file => file.isDirectory);

  if (directories.length === 0) return;

  for (const dir of directories) {
    try {
      const dirPath = dir.path;

      // find image files in the directory
      const imagesQuery = `
        SELECT path
        FROM files
        WHERE path LIKE ? AND mimeType LIKE 'image/%'
        ORDER BY name ASC
        LIMIT 1
      `;

      const dirPattern = `${dirPath}/%`;
      const coverImage = db.prepare(imagesQuery).get(dirPattern);

      if (coverImage) {
        dir.cover = coverImage.path;
      }
    } catch (error) {
      console.error(`Error finding cover for directory ${dir.path}:`, error);
    }
  }
}

function saveFileBatch(files) {
  if (!db) {
    console.error('Database not initialized in saveFileBatch');
    return 0;
  }

  const insert = db.prepare(SQL.INSERT_FILE);

  const insertMany = db.transaction((filesList) => {
    let count = 0;
    for (const file of filesList) {
      try {
        insert.run(
          file.name,
          file.path,
          file.size,
          file.mtime,
          file.mimeType,
          file.isDirectory ? 1 : 0
        );
        count++;
      } catch (error) {
        console.error(`Error inserting file ${file.path}:`, error.message);
      }
    }
    return count;
  });

  try {
    const count = insertMany(files);

    indexProgress.lastUpdated = new Date().toISOString();

    return count;
  } catch (error) {
    console.error('Error saving file batch:', error);
    return 0;
  }
}


async function countFilesBFS(directory) {
  let totalCount = 0;
  let queue = [directory];
  let processed = new Set();

  while (queue.length > 0) {
    // Process directories in batches to limit memory usage
    const batchSize = 10;
    const batch = queue.splice(0, batchSize);

    // Process each directory in the batch
    await Promise.all(batch.map(async (dir) => {
      if (processed.has(dir)) return;
      processed.add(dir);

      try {
        const entries = await fs.promises.readdir(dir);
        let fileCount = 0;
        let newDirs = [];

        // Process entries in smaller chunks to reduce memory pressure
        for (let i = 0; i < entries.length; i += 50) {
          const chunk = entries.slice(i, i + 50);

          await Promise.all(chunk.map(async (entry) => {
            const fullPath = path.join(dir, entry);

            try {
              const stats = await fs.promises.stat(fullPath);

              if (stats.isDirectory()) {
                newDirs.push(fullPath);
              } else {
                fileCount++;
              }
            } catch (error) {
              console.error(`Error accessing ${fullPath}:`, error.message);
            }
          }));
        }

        totalCount += fileCount;
        queue.push(...newDirs);
      } catch (error) {
        console.error(`Error reading directory ${dir}:`, error.message);
      }
    }));
  }

  return totalCount;
}

async function countFilesDFS(directory) {
  let count = 0;

  try {
    const files = await fs.promises.readdir(directory);

    const batchSize = config.countFilesBatchSize || 100;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const counts = await Promise.all(batch.map(async (file) => {
        const fullPath = path.join(directory, file);

        try {
          const stats = await fs.promises.stat(fullPath);

          if (stats.isDirectory()) {
            return await countFilesDFS(fullPath);
          } else {
            return 1;
          }
        } catch (error) {
          console.error(`Error accessing ${fullPath}:`, error.message);
          return 0;
        }
      }));

      count += counts.reduce((sum, c) => sum + c, 0);
    }
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error.message);
  }

  return count;
}

async function createCountWorker(directory) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: {
        task: 'countFiles',
        directory,
        algorithm: config.indexerSearchAlgorithm || 'bfs'
      }
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


async function indexFilesDFS(directory, basePath, results, batchSize, workerIndex = 0, workerCount = 1) {
  try {
    const files = await fs.promises.readdir(directory);

    // Add the directory itself to the index (only if it's not the base path)
    if (directory !== basePath) {
      // Use hash partitioning to ensure the directory is only processed by one worker
      const dirHash = Math.abs(directory.split('').reduce((hash, char) => {
        return ((hash << 5) - hash) + char.charCodeAt(0);
      }, 0));

      // Only process this directory if its hash modulo workerCount equals this worker's index
      if (dirHash % workerCount === workerIndex) {
        try {
          const stats = await fs.promises.stat(directory);
          const relativePath = path.relative(basePath, directory);
          const normalizedPath = utils.normalizePath(relativePath);

          // Add directory to results
          results.push({
            name: path.basename(directory),
            path: normalizedPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: 'directory', // Use a special MIME type for directories
            isDirectory: true
          });

          // If batch size reached, send to parent
          if (results.length >= batchSize) {
            const batch = [...results];
            results.length = 0;

            parentPort.postMessage({
              type: 'batch',
              files: batch
            });
          }
        } catch (error) {
          console.error(`Error processing directory ${directory}:`, error.message);
        }
      }
    }

    // Process files
    const concurrencyLimit = config.indexerConcurrencyLimit;
    const useConcurrency = config.indexerConcurrencyEnabled;
    let fileLimit;

    if (useConcurrency) {
      fileLimit = createConcurrencyLimiter(concurrencyLimit);
    }

    const processBatch = async (batch) => {
      if (useConcurrency) {
        return Promise.all(batch.map(async (file) => fileLimit(async () => {
          await processFile(file);
        })));
      } else {
        return Promise.all(batch.map(processFile));
      }
    };

    async function processFile(file) {
      const fullPath = path.join(directory, file);

      try {
        const stats = await fs.promises.stat(fullPath);
        const isDir = stats.isDirectory();

        if (isDir) {
          // For directories, recursively process content
          await indexFilesDFS(fullPath, basePath, results, batchSize, workerIndex, workerCount);
        } else {
          // Partition files among workers using a simple hash
          const fileHash = Math.abs(fullPath.split('').reduce((hash, char) => {
            return ((hash << 5) - hash) + char.charCodeAt(0);
          }, 0));

          // Only process this file if its hash modulo workerCount equals this worker's index
          if (fileHash % workerCount === workerIndex) {
            const relativePath = path.relative(basePath, fullPath);
            const normalizedPath = utils.normalizePath(relativePath);
            const fileExt = path.extname(file).toLowerCase();

            let mimeType;
            if (fileExt && mimeTypeCache.has(fileExt)) {
              mimeType = mimeTypeCache.get(fileExt);
            } else {
              mimeType = await utils.getFileType(fullPath);
              if (fileExt) {
                mimeTypeCache.set(fileExt, mimeType);
              }
            }

            results.push({
              name: file,
              path: normalizedPath,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
              mimeType: mimeType,
              isDirectory: false
            });

            if (results.length >= batchSize) {
              const batch = [...results];
              results.length = 0;

              parentPort.postMessage({
                type: 'batch',
                files: batch
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error accessing ${fullPath}:`, error.message);
      }
    }

    const processingBatchSize = 100;
    for (let i = 0; i < files.length; i += processingBatchSize) {
      const batch = files.slice(i, i + processingBatchSize);
      await processBatch(batch);
    }
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error.message);
  }
}

async function indexFilesBFS(basePath, batchSize, workerIndex, workerCount) {
  const queue = [{
    dir: basePath,
    depth: 0,
    isBaseDir: true
  }];

  const processedDirs = new Set();
  const results = [];

  // Create a concurrency limiter for file processing if enabled
  const useConcurrency = config.indexerConcurrencyEnabled;
  const concurrencyLimit = config.indexerConcurrencyLimit;
  const fileLimit = useConcurrency ? createConcurrencyLimiter(concurrencyLimit) : null;

  while (queue.length > 0) {
    // Get the next directory to process
    const { dir, depth, isBaseDir } = queue.shift();

    // Skip if already processed
    if (processedDirs.has(dir)) continue;
    processedDirs.add(dir);

    try {
      // Process this directory (except base directory) based on worker distribution
      if (!isBaseDir) {
        // Use hash partitioning to ensure the directory is only processed by one worker
        const dirHash = Math.abs(dir.split('').reduce((hash, char) => {
          return ((hash << 5) - hash) + char.charCodeAt(0);
        }, 0));

        // Only process this directory if its hash modulo workerCount equals this worker's index
        if (dirHash % workerCount === workerIndex) {
          const stats = await fs.promises.stat(dir);
          const relativePath = path.relative(basePath, dir);
          const normalizedPath = utils.normalizePath(relativePath);

          // Add directory to results
          results.push({
            name: path.basename(dir),
            path: normalizedPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
          });

          // Send batch if size threshold reached
          if (results.length >= batchSize) {
            const batch = [...results];
            results.length = 0;

            parentPort.postMessage({
              type: 'batch',
              files: batch
            });
          }
        }
      }

      // Read directory entries
      const entries = await fs.promises.readdir(dir);

      // Array to hold promises for subdirectories
      const subdirPromises = [];

      // Process files with or without concurrency limit
      const processEntry = async (entry) => {
        const fullPath = path.join(dir, entry);

        try {
          const stats = await fs.promises.stat(fullPath);

          if (stats.isDirectory()) {
            // Add subdirectory to queue for breadth-first processing
            subdirPromises.push(Promise.resolve({
              dir: fullPath,
              depth: depth + 1,
              isBaseDir: false
            }));
          } else {
            // Partition files among workers using hash
            const fileHash = Math.abs(fullPath.split('').reduce((hash, char) => {
              return ((hash << 5) - hash) + char.charCodeAt(0);
            }, 0));

            // Only process this file if its hash modulo workerCount equals this worker's index
            if (fileHash % workerCount === workerIndex) {
              const relativePath = path.relative(basePath, fullPath);
              const normalizedPath = utils.normalizePath(relativePath);
              const fileExt = path.extname(entry).toLowerCase();

              let mimeType;
              if (fileExt && mimeTypeCache.has(fileExt)) {
                mimeType = mimeTypeCache.get(fileExt);
              } else {
                mimeType = await utils.getFileType(fullPath);
                if (fileExt) {
                  mimeTypeCache.set(fileExt, mimeType);
                }
              }

              results.push({
                name: entry,
                path: normalizedPath,
                size: stats.size,
                mtime: stats.mtime.toISOString(),
                mimeType: mimeType,
                isDirectory: false
              });

              // Send batch if size threshold reached
              if (results.length >= batchSize) {
                const batch = [...results];
                results.length = 0;

                parentPort.postMessage({
                  type: 'batch',
                  files: batch
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error accessing ${fullPath}:`, error.message);
        }
      };

      // Process files - with or without concurrency
      if (useConcurrency) {
        const filePromises = entries.map(entry => fileLimit(() => processEntry(entry)));
        await Promise.all(filePromises);
      } else {
        for (const entry of entries) {
          await processEntry(entry);
        }
      }

      // Collect all subdirectories and add them to the queue
      const subdirs = await Promise.all(subdirPromises);
      queue.push(...subdirs);

    } catch (error) {
      console.error(`Error processing directory ${dir}:`, error.message);
    }
  }

  // Send any remaining results
  if (results.length > 0) {
    parentPort.postMessage({
      type: 'batch',
      files: results
    });
  }

  // Signal completion
  parentPort.postMessage({
    type: 'complete'
  });
}

function createStreamingIndexWorker(directories, basePath, workerIndex, workerCount) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: {
        task: 'indexFiles',
        algorithm: config.indexerSearchAlgorithm || 'bfs',
        directories,
        basePath,
        batchSize: config.indexBatchSize || 100,
        workerIndex,
        workerCount
      }
    });

    // No longer accumulate all files in memory
    let processedCount = 0;
    let errorCount = 0;

    worker.on('message', (message) => {
      if (message.type === 'batch') {
        // Process batch depending on storage mode
        if (config.indexerStorageMode === 'immediate') {
          // Immediately save to database
          const count = saveFileBatch(message.files);

          // Filter out directories before counting processed files
          const fileOnlyCount = message.files.filter(file => !file.isDirectory).length;
          const fileProcessedCount = Math.min(fileOnlyCount, count);

          processedCount += fileProcessedCount;
          errorCount += (fileOnlyCount - fileProcessedCount);

          // Update progress after each batch save (excluding directories)
          indexProgress.processed += fileProcessedCount;
          indexProgress.errors += (fileOnlyCount - fileProcessedCount);
          indexProgress.lastUpdated = new Date().toISOString();

          // Calculate and log progress percentage
          const percentComplete = indexProgress.total > 0
            ? Math.round((indexProgress.processed / indexProgress.total) * 100)
            : 0;
          console.log(`Indexed ${indexProgress.processed}/${indexProgress.total} files (${percentComplete}%)`);
        } else {
          // Batch mode - accumulate files
          processedCount += message.files.filter(file => !file.isDirectory).length;
          workerResults.push(...message.files);
        }
      } else if (message.type === 'complete') {
        // Return statistics about processed files
        resolve({
          files: workerResults || [], // Only used in batch mode
          processed: processedCount,
          errors: errorCount
        });
      }
    });

    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });

    // Store worker results if in batch mode
    const workerResults = config.indexerStorageMode === 'batch' ? [] : null;
  });
}


// Worker thread handling
if (!isMainThread) {
  const {
    task,
    algorithm = 'bfs',
    directories,
    basePath,
    directory,
    batchSize = 1000,
    workerIndex = 0,
    workerCount = 1
  } = workerData;

  if (task === 'indexFiles') {
    if (algorithm === 'bfs') {
      // Use breadth-first search
      indexFilesBFS(basePath, batchSize, workerIndex, workerCount)
        .catch(error => console.error('Error in BFS indexing worker:', error));
    } else {
      // Use depth-first search
      const taskQueue = [...directories];
      let currentFiles = [];

      (async () => {
        while (taskQueue.length > 0) {
          const dir = taskQueue.shift();
          try {
            await indexFilesDFS(dir, basePath, currentFiles, batchSize, workerIndex, workerCount);
          } catch (error) {
            console.error(`Error indexing directory ${dir}:`, error);
          }
        }

        if (currentFiles.length > 0) {
          parentPort.postMessage({
            type: 'batch',
            files: currentFiles
          });
        }

        parentPort.postMessage({
          type: 'complete'
        });
      })();
    }
  }
  else if (task === 'countFiles') {
    (async () => {
      let count = 0;

      try {
        if (algorithm === 'bfs') {
          count = await countFilesBFS(directory);
        } else {
          count = await countFilesDFS(directory);
        }
      } catch (error) {
        console.error(`Error counting files in ${directory}:`, error);
      }

      parentPort.postMessage(count);
    })();
  }
}

// Calculate the optimal worker count based on system resources
function calculateOptimalWorkerCount() {
  // If user specified an exact count, use that
  if (config.indexerWorkerCount > 0) {
    return config.indexerWorkerCount;
  }

  // Otherwise calculate based on CPU cores and available memory
  const cpuCount = os.cpus().length;
  const memoryGB = os.totalmem() / 1024 / 1024 / 1024;

  // Adjust worker count based on system memory
  let workerCount;
  if (memoryGB < 4) {
    workerCount = Math.max(1, Math.floor(cpuCount * 0.5)); // Use half the cores on low memory systems
  } else if (memoryGB < 8) {
    workerCount = Math.max(2, Math.floor(cpuCount * 0.75)); // Use 75% of cores on medium memory systems
  } else {
    workerCount = Math.max(2, cpuCount); // Use full cores on high memory systems
  }

  return workerCount;
}

function getRandomImageFromIndex(directory = '', recursive = true) {
  const result = findFilesInIndex(directory, 'image', {
    sortBy: 'RANDOM()',
    limit: 1,
    recursive
  });

  return result.files[0] || null;
}

// Main function to build the index
async function buildIndex(basePath) {
  const algorithm = config.indexerSearchAlgorithm || 'bfs';
  const storageMode = config.indexerStorageMode || 'batch';

  console.log(`Building index using ${algorithm} algorithm with ${storageMode} storage mode`);

  if (isIndexBuilding) {
    return {
      success: false,
      message: 'Index build already in progress'
    };
  }

  isIndexBuilding = true;
  const now = new Date().toISOString();
  indexProgress = {
    total: 0,
    processed: 0,
    errors: 0,
    lastUpdated: now,
    startTime: now,
  };

  try {
    // Ensure database is initialized
    if (!db) initializeDatabase();

    clearIndex();
    mimeTypeCache.clear(); // Clear the MIME type cache before starting

    console.log('Counting files in', basePath);
    const fileCount = await createCountWorker(basePath);
    indexProgress.total = fileCount;
    console.log(`Found ${fileCount} files to index`);

    // Calculate optimal worker count
    const workerCount = calculateOptimalWorkerCount();
    console.log(`Starting indexing with ${workerCount} workers`);

    const workerPromises = [];

    for (let i = 0; i < workerCount; i++) {
      // Use streaming workers for immediate or batch mode
      workerPromises.push(
        createStreamingIndexWorker([basePath], basePath, i, workerCount)
      );
    }

    // Wait for workers to complete
    const workerResults = await Promise.all(workerPromises);

    // For batch mode, we need to save all files at once
    if (storageMode === 'batch') {
      console.log('Processing batched files...');
      // Flatten the array of file arrays
      const allFiles = [];
      for (const result of workerResults) {
        allFiles.push(...result.files);
      }

      // Save files in batches to avoid memory issues
      const batchSize = config.indexBatchSize || 1000;
      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        const count = saveFileBatch(batch);

        // Only count non-directory files for progress
        const fileOnlyCount = batch.filter(file => !file.isDirectory).length;

        indexProgress.processed += fileOnlyCount;
        indexProgress.lastUpdated = new Date().toISOString();

        // Calculate and log progress percentage
        const percentComplete = indexProgress.total > 0
          ? Math.round((indexProgress.processed / indexProgress.total) * 100)
          : 0;
        console.log(`Indexed ${indexProgress.processed}/${indexProgress.total} files (${percentComplete}%)`);
      }
    }

    // Aggregate statistics from all workers
    const totalStats = workerResults.reduce(
      (acc, result) => {
        acc.processed += result.processed;
        acc.errors += result.errors || 0;
        return acc;
      },
      { processed: 0, errors: 0 }
    );

    // Update the metadata
    const completionTime = new Date().toISOString();
    db.prepare(SQL.UPDATE_METADATA).run('last_built', completionTime);
    db.prepare(SQL.UPDATE_METADATA).run('base_directory', basePath);

    // Ensure all writes are completed
    db.pragma('wal_checkpoint(FULL)');

    console.log(`Indexing complete. Indexed ${totalStats.processed} files.`);

    isIndexBuilding = false;
    // In immediate mode, progress is already updated during processing
    if (storageMode === 'batch') {
      indexProgress.processed = totalStats.processed;
      indexProgress.errors = totalStats.errors;
    }
    indexProgress.lastUpdated = new Date().toISOString();

    return {
      success: true,
      stats: { ...indexProgress }
    };
  } catch (error) {
    console.error('Error building index:', error);
    isIndexBuilding = false;
    return {
      success: false,
      message: error.message
    };
  }
}

module.exports = {
  initializeDatabase,
  isIndexBuilt,
  getIndexStats,
  clearIndex,
  deleteFromIndex,
  searchIndex,
  findImagesInIndex,
  findAudiosInIndex,
  findVideosInIndex,
  getRandomImageFromIndex,
  getDirectoryFiles,
  saveFileBatch,
  buildIndex,
};