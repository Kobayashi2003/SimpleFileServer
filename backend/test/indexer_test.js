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
      parent INTEGER,
      size INTEGER NOT NULL,
      mtime TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      isDirectory INTEGER NOT NULL,
      FOREIGN KEY (parent) REFERENCES files(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime);
    CREATE INDEX IF NOT EXISTS idx_files_mimeType ON files(mimeType);
    CREATE INDEX IF NOT EXISTS idx_files_isDirectory ON files(isDirectory);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_files_parent_name ON files(parent, name);
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
  INSERT OR REPLACE INTO files (name, parent, size, mtime, mimeType, isDirectory) 
  VALUES (?, ?, ?, ?, ?, ?)
  `,
  GET_FILE_BY_PARENT_NAME: 'SELECT * FROM files WHERE parent = ? AND name = ?',
  GET_FILE_BY_ID: 'SELECT * FROM files WHERE id = ?',
  GET_ROOT_FILES: 'SELECT * FROM files WHERE parent IS NULL',
  GET_CHILDREN: 'SELECT * FROM files WHERE parent = ?',
  DELETE_FILE_BY_ID: 'DELETE FROM files WHERE id = ?',
  DELETE_ALL_FILES: 'DELETE FROM files',
  
  // Recursive CTE queries for path operations
  GET_PATH_CTE: `
    WITH RECURSIVE file_path(id, name, parent, path) AS (
      SELECT id, name, parent, name as path FROM files WHERE id = ?
      UNION ALL
      SELECT f.id, f.name, f.parent, f.name || '/' || fp.path
      FROM files f JOIN file_path fp ON f.id = fp.parent
    )
    SELECT path FROM file_path WHERE parent IS NULL
  `,
  
  FIND_BY_PATH_CTE: `
    WITH RECURSIVE path_parts AS (
      SELECT ? as full_path, '' as processed, ? as remaining
      UNION ALL
      SELECT full_path, 
             CASE WHEN processed = '' THEN substr(remaining, 1, instr(remaining || '/', '/') - 1)
                  ELSE processed || '/' || substr(remaining, 1, instr(remaining || '/', '/') - 1) END,
             CASE WHEN instr(remaining, '/') = 0 THEN ''
                  ELSE substr(remaining, instr(remaining, '/') + 1) END
      FROM path_parts 
      WHERE remaining != ''
    ),
    path_traversal AS (
      SELECT f.id, f.name, f.parent, 0 as depth, f.name as current_path
      FROM files f 
      WHERE f.parent IS NULL AND f.name = (SELECT substr(?, 1, instr(? || '/', '/') - 1))
      UNION ALL
      SELECT f.id, f.name, f.parent, pt.depth + 1,
             pt.current_path || '/' || f.name
      FROM path_traversal pt
      JOIN files f ON f.parent = pt.id
      WHERE pt.current_path != ? AND f.name = (
        SELECT substr(substr(?, length(pt.current_path) + 2), 1, 
               instr(substr(?, length(pt.current_path) + 2) || '/', '/') - 1)
        WHERE length(pt.current_path) < length(?)
      )
    )
    SELECT * FROM path_traversal WHERE current_path = ?
  `
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

// Path cache to avoid repeated path reconstruction
const pathCache = new Map();

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

const mimeTypeCache = new LimitedSizeCache(5000);

// Helper function to build full path from file ID
function buildPathFromId(fileId) {
  if (pathCache.has(fileId)) {
    return pathCache.get(fileId);
  }

  const pathParts = [];
  let currentId = fileId;
  
  while (currentId !== null) {
    const file = db.prepare(SQL.GET_FILE_BY_ID).get(currentId);
    if (!file) break;
    
    pathParts.unshift(file.name);
    currentId = file.parent;
  }
  
  const fullPath = pathParts.join('/');
  pathCache.set(fileId, fullPath);
  return fullPath;
}

// Helper function to find file by path
function findFileByPath(targetPath) {
  if (!targetPath) {
    // Return root directory representation
    return { id: null, name: '', parent: null, isDirectory: 1 };
  }

  const pathParts = targetPath.split('/').filter(part => part.length > 0);
  let currentParent = null;
  let currentFile = null;

  for (const part of pathParts) {
    currentFile = db.prepare(SQL.GET_FILE_BY_PARENT_NAME).get(currentParent, part);
    if (!currentFile) return null;
    currentParent = currentFile.id;
  }

  return currentFile;
}

// Helper function to get all descendants of a directory
function getAllDescendants(parentId) {
  const descendants = [];
  const queue = [parentId];
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    const children = db.prepare(SQL.GET_CHILDREN).all(currentId);
    
    for (const child of children) {
      descendants.push(child);
      if (child.isDirectory) {
        queue.push(child.id);
      }
    }
  }
  
  return descendants;
}

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
    db = new Database(config.fileIndexPath.replace('.db', '2.db')); // Use separate database
    db.exec(SQL.CREATE_FILES_TABLE);
    db.exec(SQL.CREATE_METADATA_TABLE);

    console.log('Database initialized at', config.fileIndexPath.replace('.db', '2.db'));
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

function isIndexBuilt() {
  if (!db) return false;

  try {
    const result = db.prepare(SQL.GET_LAST_BUILT).get();
    const lastBuilt = result && result.value !== null;

    const baseDirectoryResult = db.prepare(SQL.GET_BASE_DIRECTORY).get();
    const baseDirectoryMatches = baseDirectoryResult && baseDirectoryResult.value === config.baseDirectory;

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
    db.prepare(SQL.UPDATE_METADATA).run('last_built', null);
    db.prepare(SQL.UPDATE_METADATA).run('base_directory', null);
    pathCache.clear();
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
    const file = findFileByPath(filePath);
    if (!file) return false;

    if (file.isDirectory) {
      // Delete all descendants first
      const descendants = getAllDescendants(file.id);
      for (const desc of descendants) {
        db.prepare(SQL.DELETE_FILE_BY_ID).run(desc.id);
        pathCache.delete(desc.id);
      }
    }

    // Delete the file/directory itself
    const result = db.prepare(SQL.DELETE_FILE_BY_ID).run(file.id);
    pathCache.delete(file.id);

    if (result.changes > 0) {
      console.log(`Removed ${filePath} from index`);
      return true;
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
    
    // Find the directory to search in
    let searchRootId = null;
    if (directory) {
      const dirFile = findFileByPath(directory);
      if (!dirFile) return { results: [], total: 0, hasMore: false };
      searchRootId = dirFile.id;
    }

    // Build base query conditions
    let conditions = ['name LIKE ?'];
    let params = [searchTerm];

    // Add directory filtering
    if (directory && searchRootId !== null) {
      if (recursive) {
        // For recursive search, use CTE to find all descendants
        conditions.push(`id IN (
          WITH RECURSIVE descendants AS (
            SELECT id FROM files WHERE id = ?
            UNION ALL
            SELECT f.id FROM files f 
            JOIN descendants d ON f.parent = d.id
          )
          SELECT id FROM descendants WHERE id != ?
        )`);
        params.push(searchRootId, searchRootId);
      } else {
        // For non-recursive search, only direct children
        conditions.push('parent = ?');
        params.push(searchRootId);
      }
    } else if (!directory) {
      if (!recursive) {
        // Root level only
        conditions.push('parent IS NULL');
      }
    }

    // Add file type filtering
    if (type && ['image', 'audio', 'video'].includes(type)) {
      conditions.push('mimeType LIKE ?');
      params.push(`${type}/%`);
    }

    // Count query
    const countSql = `SELECT COUNT(*) as count FROM files WHERE ${conditions.join(' AND ')}`;
    const totalCount = db.prepare(countSql).get(...params).count;

    // Main query
    let mainSql = `SELECT * FROM files WHERE ${conditions.join(' AND ')}`;
    
    // Add sorting
    mainSql += ` ORDER BY isDirectory DESC, ${sortBy === 'name' ? 'name' : sortBy} ${sortOrder.toUpperCase()}`;

    let results;
    let hasMore = false;

    // Handle pagination
    if (page !== undefined && limit !== undefined) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;
      const offset = (pageNum - 1) * limitNum;

      mainSql += ' LIMIT ? OFFSET ?';
      results = db.prepare(mainSql).all(...params, limitNum, offset);
      hasMore = offset + results.length < totalCount;
    } else {
      results = db.prepare(mainSql).all(...params);
    }

    // Convert results to include path information
    const formattedResults = results.map(file => ({
      ...file,
      path: buildPathFromId(file.id),
      mtime: new Date(file.mtime),
      isDirectory: !!file.isDirectory
    }));

    return {
      results: formattedResults,
      total: totalCount,
      hasMore
    };
  } catch (error) {
    console.error('Error searching index:', error);
    return { results: [], total: 0, hasMore: false };
  }
}

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
    // Find the directory to search in
    let searchRootId = null;
    if (directory) {
      const dirFile = findFileByPath(directory);
      if (!dirFile) return { files: [], total: 0, hasMore: false };
      searchRootId = dirFile.id;
    }

    // Build query conditions
    let conditions = [];
    let params = [];

    // Add directory filtering
    if (directory && searchRootId !== null) {
      if (recursive) {
        conditions.push(`id IN (
          WITH RECURSIVE descendants AS (
            SELECT id FROM files WHERE id = ?
            UNION ALL
            SELECT f.id FROM files f 
            JOIN descendants d ON f.parent = d.id
          )
          SELECT id FROM descendants WHERE id != ?
        )`);
        params.push(searchRootId, searchRootId);
      } else {
        conditions.push('parent = ?');
        params.push(searchRootId);
      }
    } else if (!directory) {
      if (!recursive) {
        conditions.push('parent IS NULL');
      }
    }

    // Add file type filtering
    switch (fileType) {
      case 'image':
        conditions.push("mimeType LIKE 'image/%'");
        break;
      case 'video':
        conditions.push("mimeType LIKE 'video/%'");
        break;
      case 'audio':
        conditions.push("mimeType LIKE 'audio/%'");
        break;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count query
    const countSql = `SELECT COUNT(*) as count FROM files ${whereClause}`;
    const totalCount = db.prepare(countSql).get(...params).count;

    // Main query
    let mainSql = `SELECT * FROM files ${whereClause}`;
    mainSql += ` ORDER BY isDirectory DESC, ${sortBy === 'name' ? 'name' : sortBy} ${sortOrder.toUpperCase()}`;

    let results;
    let hasMore = false;

    if (page !== undefined && limit !== undefined) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;
      const offset = (pageNum - 1) * limitNum;

      mainSql += ' LIMIT ? OFFSET ?';
      results = db.prepare(mainSql).all(...params, limitNum, offset);
      hasMore = offset + limitNum < totalCount;
    } else {
      results = db.prepare(mainSql).all(...params);
    }

    // Convert results to include path information
    const formattedResults = results.map(file => ({
      ...file,
      path: buildPathFromId(file.id),
      mtime: new Date(file.mtime),
      isDirectory: !!file.isDirectory
    }));

    return {
      files: formattedResults,
      total: totalCount,
      hasMore
    };
  } catch (error) {
    console.error('Error finding files in index:', error);
    return { files: [], total: 0, hasMore: false };
  }
}

function findMediaInIndex(directory = '', mediaType = 'image', options = {}) {
  const {
    page,
    limit = 100,
    sortBy = 'name',
    sortOrder = 'asc',
    recursive = true
  } = options;

  return findFilesInIndex(directory, mediaType, {
    page, limit, sortBy, sortOrder, recursive
  });
}

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
  const validSortFields = ['name', 'size', 'mtime'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
  const order = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY isDirectory DESC, ${sortField} ${order}`;
}

async function getDirectoryFiles(directory = '', page, limit, sortBy = 'name', sortOrder = 'asc', includeCover = false) {
  if (!db) return { files: [], total: 0, hasMore: false };

  try {
    // Find the directory to list
    let parentId = null;
    if (directory) {
      const dirFile = findFileByPath(directory);
      if (!dirFile) return { files: [], total: 0, hasMore: false };
      parentId = dirFile.id;
    }

    // Get direct children only
    const children = db.prepare(SQL.GET_CHILDREN).all(parentId);
    const totalCount = children.length;

    // Apply sorting
    children.sort((a, b) => {
      // Directories first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      
      // Then by specified field
      let aVal = a[sortBy] || a.name;
      let bVal = b[sortBy] || b.name;
      
      if (sortBy === 'mtime') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }
      
      const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortOrder.toLowerCase() === 'desc' ? -comparison : comparison;
    });

    // Handle pagination
    let files = children;
    let hasMore = false;

    if (page !== undefined) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 100;
      const offset = (pageNum - 1) * limitNum;

      files = children.slice(offset, offset + limitNum);
      hasMore = offset + files.length < totalCount;
    }

    // Convert results to include path information
    const result = files.map(file => ({
      ...file,
      path: buildPathFromId(file.id),
      isDirectory: !!file.isDirectory,
      mtime: new Date(file.mtime)
    }));

    // Add directory covers if requested
    if (includeCover && result.length > 0) {
      await addDirectoryCovers(result, directory);
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
  const directories = files.filter(file => file.isDirectory);

  if (directories.length === 0) return;

  for (const dir of directories) {
    try {
      // Find image files in the directory
      const children = db.prepare(SQL.GET_CHILDREN).all(dir.id);
      const imageChild = children.find(child => 
        !child.isDirectory && child.mimeType && child.mimeType.startsWith('image/')
      );

      if (imageChild) {
        dir.cover = buildPathFromId(imageChild.id);
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
  const select = db.prepare(SQL.GET_FILE_BY_PARENT_NAME);

  const insertMany = db.transaction((filesList) => {
    let count = 0;
    
    // Build directory structure first
    const directories = filesList.filter(f => f.isDirectory);
    const files = filesList.filter(f => !f.isDirectory);
    
    // Process directories in order (parents before children)
    directories.sort((a, b) => {
      const aDepth = a.path.split('/').length;
      const bDepth = b.path.split('/').length;
      return aDepth - bDepth;
    });
    
    // Insert directories
    for (const dir of directories) {
      try {
        let parentId = null;
        
        if (dir.path) {
          const pathParts = dir.path.split('/');
          pathParts.pop(); // Remove current directory name
          
          if (pathParts.length > 0) {
            const parentPath = pathParts.join('/');
            const parentFile = findFileByPath(parentPath);
            if (parentFile) {
              parentId = parentFile.id;
            }
          }
        }
        
        const result = insert.run(
          dir.name,
          parentId,
          dir.size,
          dir.mtime,
          dir.mimeType,
          1
        );
        
        pathCache.set(result.lastInsertRowid, dir.path);
        count++;
      } catch (error) {
        console.error(`Error inserting directory ${dir.path}:`, error.message);
      }
    }
    
    // Insert files
    for (const file of files) {
      try {
        let parentId = null;
        
        if (file.path) {
          const pathParts = file.path.split('/');
          pathParts.pop(); // Remove file name
          
          if (pathParts.length > 0) {
            const parentPath = pathParts.join('/');
            const parentFile = findFileByPath(parentPath);
            if (parentFile) {
              parentId = parentFile.id;
            }
          }
        }
        
        const result = insert.run(
          file.name,
          parentId,
          file.size,
          file.mtime,
          file.mimeType,
          0
        );
        
        pathCache.set(result.lastInsertRowid, file.path);
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

// File counting functions
async function countFilesBFS(directory) {
  let totalCount = 0;
  let queue = [directory];
  let processed = new Set();

  while (queue.length > 0) {
    const batchSize = 10;
    const batch = queue.splice(0, batchSize);

    await Promise.all(batch.map(async (dir) => {
      if (processed.has(dir)) return;
      processed.add(dir);

      try {
        const entries = await fs.promises.readdir(dir);
        let fileCount = 0;
        let newDirs = [];

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

// Indexing functions with parent ID structure
async function indexFilesDFS(directory, basePath, results, batchSize, workerIndex = 0, workerCount = 1) {
  try {
    const files = await fs.promises.readdir(directory);

    // Add the directory itself to the index (only if it's not the base path)
    if (directory !== basePath) {
      const dirHash = Math.abs(directory.split('').reduce((hash, char) => {
        return ((hash << 5) - hash) + char.charCodeAt(0);
      }, 0));

      if (dirHash % workerCount === workerIndex) {
        try {
          const stats = await fs.promises.stat(directory);
          const relativePath = path.relative(basePath, directory);
          const normalizedPath = utils.normalizePath(relativePath);

          results.push({
            name: path.basename(directory),
            path: normalizedPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
          });

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
          await indexFilesDFS(fullPath, basePath, results, batchSize, workerIndex, workerCount);
        } else {
          const fileHash = Math.abs(fullPath.split('').reduce((hash, char) => {
            return ((hash << 5) - hash) + char.charCodeAt(0);
          }, 0));

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

  const useConcurrency = config.indexerConcurrencyEnabled;
  const concurrencyLimit = config.indexerConcurrencyLimit;
  const fileLimit = useConcurrency ? createConcurrencyLimiter(concurrencyLimit) : null;

  while (queue.length > 0) {
    const { dir, depth, isBaseDir } = queue.shift();

    if (processedDirs.has(dir)) continue;
    processedDirs.add(dir);

    try {
      if (!isBaseDir) {
        const dirHash = Math.abs(dir.split('').reduce((hash, char) => {
          return ((hash << 5) - hash) + char.charCodeAt(0);
        }, 0));

        if (dirHash % workerCount === workerIndex) {
          const stats = await fs.promises.stat(dir);
          const relativePath = path.relative(basePath, dir);
          const normalizedPath = utils.normalizePath(relativePath);

          results.push({
            name: path.basename(dir),
            path: normalizedPath,
            size: stats.size,
            mtime: stats.mtime.toISOString(),
            mimeType: 'directory',
            isDirectory: true
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

      const entries = await fs.promises.readdir(dir);
      const subdirPromises = [];

      const processEntry = async (entry) => {
        const fullPath = path.join(dir, entry);

        try {
          const stats = await fs.promises.stat(fullPath);

          if (stats.isDirectory()) {
            subdirPromises.push(Promise.resolve({
              dir: fullPath,
              depth: depth + 1,
              isBaseDir: false
            }));
          } else {
            const fileHash = Math.abs(fullPath.split('').reduce((hash, char) => {
              return ((hash << 5) - hash) + char.charCodeAt(0);
            }, 0));

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

      if (useConcurrency) {
        const filePromises = entries.map(entry => fileLimit(() => processEntry(entry)));
        await Promise.all(filePromises);
      } else {
        for (const entry of entries) {
          await processEntry(entry);
        }
      }

      const subdirs = await Promise.all(subdirPromises);
      queue.push(...subdirs);

    } catch (error) {
      console.error(`Error processing directory ${dir}:`, error.message);
    }
  }

  if (results.length > 0) {
    parentPort.postMessage({
      type: 'batch',
      files: results
    });
  }

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

    let processedCount = 0;
    let errorCount = 0;

    worker.on('message', (message) => {
      if (message.type === 'batch') {
        if (config.indexerStorageMode === 'immediate') {
          const count = saveFileBatch(message.files);
          const fileOnlyCount = message.files.filter(file => !file.isDirectory).length;
          const fileProcessedCount = Math.min(fileOnlyCount, count);

          processedCount += fileProcessedCount;
          errorCount += (fileOnlyCount - fileProcessedCount);

          indexProgress.processed += fileProcessedCount;
          indexProgress.errors += (fileOnlyCount - fileProcessedCount);
          indexProgress.lastUpdated = new Date().toISOString();

          const percentComplete = indexProgress.total > 0
            ? Math.round((indexProgress.processed / indexProgress.total) * 100)
            : 0;
          console.log(`Indexed ${indexProgress.processed}/${indexProgress.total} files (${percentComplete}%)`);
        } else {
          processedCount += message.files.filter(file => !file.isDirectory).length;
          workerResults.push(...message.files);
        }
      } else if (message.type === 'complete') {
        resolve({
          files: workerResults || [],
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
      indexFilesBFS(basePath, batchSize, workerIndex, workerCount)
        .catch(error => console.error('Error in BFS indexing worker:', error));
    } else {
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

function calculateOptimalWorkerCount() {
  if (config.indexerWorkerCount > 0) {
    return config.indexerWorkerCount;
  }

  const cpuCount = os.cpus().length;
  const memoryGB = os.totalmem() / 1024 / 1024 / 1024;

  let workerCount;
  if (memoryGB < 4) {
    workerCount = Math.max(1, Math.floor(cpuCount * 0.5));
  } else if (memoryGB < 8) {
    workerCount = Math.max(2, Math.floor(cpuCount * 0.75));
  } else {
    workerCount = Math.max(2, cpuCount);
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
    if (!db) initializeDatabase();

    clearIndex();
    mimeTypeCache.clear();

    console.log('Counting files in', basePath);
    const fileCount = await createCountWorker(basePath);
    indexProgress.total = fileCount;
    console.log(`Found ${fileCount} files to index`);

    const workerCount = calculateOptimalWorkerCount();
    console.log(`Starting indexing with ${workerCount} workers`);

    const workerPromises = [];

    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(
        createStreamingIndexWorker([basePath], basePath, i, workerCount)
      );
    }

    const workerResults = await Promise.all(workerPromises);

    if (storageMode === 'batch') {
      console.log('Processing batched files...');
      const allFiles = [];
      for (const result of workerResults) {
        allFiles.push(...result.files);
      }

      const batchSize = config.indexBatchSize || 1000;
      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        const count = saveFileBatch(batch);

        const fileOnlyCount = batch.filter(file => !file.isDirectory).length;

        indexProgress.processed += fileOnlyCount;
        indexProgress.lastUpdated = new Date().toISOString();

        const percentComplete = indexProgress.total > 0
          ? Math.round((indexProgress.processed / indexProgress.total) * 100)
          : 0;
        console.log(`Indexed ${indexProgress.processed}/${indexProgress.total} files (${percentComplete}%)`);
      }
    }

    const totalStats = workerResults.reduce(
      (acc, result) => {
        acc.processed += result.processed;
        acc.errors += result.errors || 0;
        return acc;
      },
      { processed: 0, errors: 0 }
    );

    const completionTime = new Date().toISOString();
    db.prepare(SQL.UPDATE_METADATA).run('last_built', completionTime);
    db.prepare(SQL.UPDATE_METADATA).run('base_directory', basePath);

    db.pragma('wal_checkpoint(FULL)');

    console.log(`Indexing complete. Indexed ${totalStats.processed} files.`);

    isIndexBuilding = false;
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