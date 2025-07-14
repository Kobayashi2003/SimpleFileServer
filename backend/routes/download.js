const config = require('../config');
const utils = require('../utils');

const fs = require('fs');
const path = require('path')
const AdmZip = require('adm-zip');
const express = require('express');
const router = express.Router();

router.post('/download', (req, res) => {
  const { path: requestedPath, paths: requestedPaths } = req.body;

  if (!requestedPath && !requestedPaths) {
    return res.status(400).json({ error: 'No path or paths provided' });
  }

  if (requestedPath !== undefined && !utils.isValidPath(requestedPath)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  } 

  if (requestedPaths !== undefined) {
    if (!Array.isArray(requestedPaths)) {
      return res.status(400).json({ error: 'Requested paths must be an array' });
    }
    for (const p of requestedPaths) {
      if (!utils.isValidPath(p)) {
        return res.status(400).json({ error: 'Invalid path provided' });
      }
    }
 }

  let pathList = [];
  if (requestedPath) {
    pathList.push(requestedPath.trim());
  } else if (requestedPaths) {
    pathList = requestedPaths.map(p => p.trim());
  }

  try {
    const zip = new AdmZip();

    for (const p of pathList) {

      const fullPath = path.resolve(config.baseDirectory, p);

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        zip.addLocalFolder(fullPath);
      } else if (stats.isFile()) {
        zip.addLocalFile(fullPath);
      }
    }

    const zipBuffer = zip.toBuffer();
    const fileName = new Date().toISOString().replace(/[-:Z]/g, '');
    const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}.zip`);
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;