const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

// router.get('/raw', (req, res) => {

// });

router.get('/content', handleError(async (req, res) => {
  const { path: requestedPath, _encoding } = req.query;

  const encoding = _encoding || 'utf8';

  if (!utils.isValidPath(requestedPath, isFile=true)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);
  const stats = fs.statSync(fullPath);

  if (stats.size > config.contentMaxSize) {
    return res.status(413).json({ error: 'Content size exceeds the maximum limit' });
  }

  const contentType = await utils.getFileType(fullPath);
  if (!contentType.startsWith('text/')) {
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  const content = fs.readFileSync(fullPath, encoding);
  res.status(200).send(content);
}));

router.get('/_thumbnail', handleError(async (req, res) => {
  const { path: requestedPath, width = 300, height, quality = 80 } = req.query;

  if (!utils.isValidPath(requestedPath, isFile=true)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const fullPath = path.resolve(config.baseDirectory, requestedPath);

  const mimeType = await utils.getFileType(fullPath);

  if (!config.generateThumbnail) {
    if (mimeType.startsWith('image/')) {
      res.setHeader('Content-Type', mimeType);
      return fs.createReadStream(fullPath).pipe(res);
    }
    return res.status(415).json({ error: 'Unsupported media type' });
  }

  if (mimeType === 'image/bmp') {
    // Cause sharp cannot handle bmp files, I return the original file directly
    res.setHeader('Content-Type', 'image/bmp');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType === 'image/x-icon') {
    // Cause sharp cannot handle ico files, I return the original file directly
    res.setHeader('Content-Type', 'image/x-icon');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType === 'image/gif' && !config.generateThumbnailForGif) {
    res.setHeader('Content-Type', 'image/gif');
    return fs.createReadStream(fullPath).pipe(res);
  }

  if (mimeType === 'image/vnd.adobe.photoshop') {

  }

  if (mimeType.startsWith('image/')) {

  }

  if (mimeType.startsWith('video/')) {

  }

  if (mimeType === 'application/epub+zip') {

  }

}));

// router.get('/comic', (req, res) => {

// });

router.get('/archive', (req, res) => {
  // TODO: Implement archive endpoint
});

module.exports = router;