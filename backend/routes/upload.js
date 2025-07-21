const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');
const { writePermissionMiddleware } = require('../middleware/auth');

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const express = require('express');
const router = express.Router();

router.post('/upload', writePermissionMiddleware, handleError((req, res) => {
  const { dir = '' } = req.query;

  if (!utils.isValidDirectoryPath(dir)) {
    // return res.status(400).json({ error: 'Invalid path provided' });
  }

  const uploadPath = path.join(config.baseDirectory, dir);

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
      const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf-8');
      cb(null, decodedName);
    }
  });

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

    res.status(200).json({
      message: 'Files uploaded successfully',
      files: uploadedFiles
    });
  });
}));

router.post('/upload-folder', writePermissionMiddleware, handleError((req, res) => {
  const { dir = '' } = req.query;

  if (!utils.isValidDirectoryPath(dir)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const uploadPath = path.join(config.baseDirectory, dir);

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

      console.log({relativePath})

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

    res.status(200).json({
      message: 'Files and folders uploaded successfully',
      files: uploadedFiles
    });
  });
}));

module.exports = router;