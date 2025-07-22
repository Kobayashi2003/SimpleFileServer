const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler')

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

router.get('/bg', handleError(async (req, res) => {
  const bgImagePath = path.resolve(config.backgroundImagePath);

  const stats = await fs.promises.stat(bgImagePath);

  if (!stats.isFile()) {
    console.error(`Background image path is not a file: ${bgImagePath}`);
    return res.status(400).send('Path is not a file');
  }

  const contentType = await utils.getFileType(bgImagePath);

  if (!contentType.startsWith('image/')) {
    console.error(`Unsupported media type: ${contentType}`);
    return res.status(415).send('Unsupported media type');
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
  res.setHeader('Content-Length', stats.size);

  const stream = fs.createReadStream(bgImagePath, {
    highWaterMark: config.highWaterMark
  });

  stream.on('error', (err) => {
    console.error('Background image read error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read background image' });
    } else {
      res.destroy();
    }
  });

  req.on('close', () => {
    stream.destroy();
  });

  req.on('aborted', () => {
    stream.destroy();
  });

  stream.pipe(res);
}));

router.get('/bgs', handleError(async (req, res) => {
  const { width: req_width, height: req_height } = req.query;
  const bgDir = path.resolve(config.backgroundImagesDir);

  if (!fs.existsSync(bgDir)) {
    console.log(`Background images directory not found at path: ${bgDir}`);
    return res.status(404).send('Background images directory not found');
  }

  const stats = fs.statSync(bgDir);
  if (!stats.isDirectory()) {
    console.error(`Background images path is not a directory: ${bgDir}`);
    return res.status(400).send('Path is not a directory');
  }

  const files = fs.readdirSync(bgDir).filter(file => {
    const filePath = path.join(bgDir, file);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) return false;

    const ext = path.extname(file).toLowerCase();
    const contentType = utils.getFileTypeByExt(ext);
    return contentType.startsWith('image/');
  });

  if (files.length === 0) {
    return res.status(404).send('No background images found');
  }

  let selectedImage;
  const width = parseInt(req_width, 10);
  const height = parseInt(req_height, 10);

  // If both width and height are provided, find the most suitable image
  if (width > 0 && height > 0) {
    const targetRatio = parseFloat(width) / parseFloat(height);

    const images = [];

    for (const file of files) {
      try {
        const filePath = path.join(bgDir, file);
        const sharp = require('sharp');
        const metadata = await sharp(filePath).metadata();

        images.push({
          path: filePath,
          filename: file,
          width: metadata.width,
          hegith: metadata.height,
          ratio: metadata.width / metadata.height
        });
      } catch (error) {
        console.error(`Error processing background image ${file}:`, error);
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

  const ext = path.extname(selectedImage).toLowerCase();
  const contentType = utils.getFileTypeByExt(ext);

  if (!contentType.startsWith('image/')) {
    return res.status(400).json({ error: "Selected file is not an image" });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour

  const stream = fs.createReadStream(selectedImage);
  stream.pipe(res);
}));

module.exports = router;