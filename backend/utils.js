const fs = require('fs');
const path = require('path');
const config = require('./config');
const mimeMagic = require('mime-magic');

function isRecoverableError(error) {
  const fatalErrors = ['EACCES', 'EADDRINUSE', 'ECONNREFUSED'];
  return !fatalErrors.includes(error.code);
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isValidPath(filePath, isFile=false, isDirectory=false) {
  if (typeof filePath !== 'string') {
    return false;
  }
  if (filePath.trim() === '') {
    return false;
  }

  const fullPath = path.resolve(config.baseDirectory, filePath);

  if (!fullPath.startsWith(path.resolve(config.baseDirectory))) {
    return false;
  }
  if (!fs.existsSync(fullPath)) {
    return false;
  }
  if (isFile && !fs.statSync(fullPath).isFile()) {
    return false;
  }
  if (isDirectory && !fs.statSync(fullPath).isDirectory()) {
    return false;
  }
  return true;
}

function getFileTypeByMime(filePath) {
  return new Promise((resolve) => {
    mimeMagic(filePath, (err, type) => {
      if (err) {
        console.debug(`Content-based MIME detection failed for ${filePath}:`, err.message);
        const ext = path.extname(filePath).toLowerCase();
        resolve(getFileTypeByExt(ext));
      } else {
        resolve(type || 'application/octet-stream');
      }
    });
  });
}

function getFileTypeByExt(extension) {
  const contentTypes = {
    // Text
    '.txt': 'text/plain',
    '.md': 'text/markdown',

    // Image
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.psd': 'image/vnd.adobe.photoshop',
    '.avif': 'image/avif',
    '.webp': 'image/webp',

    // Video
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',

    // Audio
    '.mp3': 'audio/mpeg',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',

    // Application
    '.cbz': 'application/cbz',
    '.cbr': 'application/cbr',
    '.epub': 'application/epub+zip',
    '.pdf': 'application/pdf',
    ...config.customContentTypes
  };

  return contentTypes[extension] || 'application/octet-stream';
}

async function getFileType(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if (config.useMimeMagic) {
    if (extension === '.cbz') return 'application/cbz';
    if (extension === '.cbr') return 'application/cbr';
    if (extension === '.epub') return 'application/epub+zip';
    try {
      return await getFileTypeByMime(filePath);
    } catch (error) {
      console.error('Error detecting MIME type:', error);
      const ext = path.extname(filePath).toLowerCase();
      return getFileTypeByExt(ext);
    }
  } else {
    return getFileTypeByExt(extension);
  }
}

function getSubdirectories(dir) {
  try {
    return fs.readdirSync(dir)
      .map(file => path.join(dir, file))
      .filter(filePath => fs.statSync(filePath).isDirectory());
  } catch (error) {
    console.error('Error getting subdirectories:', error);
    return [];
  }
}

function safeDeleteDirectory(dirPath) {
  try {
    if (process.platform === 'win32') {
      const { execSync } = require('child_process');
      try {
        // try to delete the directory by cmd
        execSync(`rd /s /q "${dirPath}"`, { windowsHide: true });
        return true;
      } catch (cmdError) {
        console.error(`Command line deletion failed: ${cmdError.message}`);
        // try to delete the directory by fs.rmSync
        try {
          fs.rmSync(dirPath, { recursive: true });
          return true;
        } catch (fsError) {
          console.error(`Failed to delete directory ${dirPath} by fs.rmSync: ${fsError.message}`);
          return false;
        }
      }
    } else {
      fs.rmSync(dirPath, { recursive: true });
      return true;
    }
  } catch (error) {
    console.error(`Failed to delete directory ${dirPath}: ${error.message}`);
    return false;
  }
}

module.exports = {
  isRecoverableError,
  normalizePath,
  isValidPath,
  getFileType,
  getFileTypeByMime,
  getFileTypeByExt,
  getSubdirectories,
  safeDeleteDirectory,
}; 