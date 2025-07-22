const config = require('../config');
const utils = require('../utils');

const path = require('path')
const { Worker } = require('worker_threads');

const express = require('express');
const router = express.Router();

router.post('/download', async (req, res) => {
  const { path: requestedPath, paths: requestedPaths } = req.body;

  if (!requestedPath && !requestedPaths) {
    return res.status(400).json({ error: 'No path provided' });
  }

  if (requestedPath && !(await utils.isValidPath(requestedPath))) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  if (requestedPaths) {
    if (!Array.isArray(requestedPaths)) {
      return res.status(400).json({ error: 'Paths must be an array' });
    }
    for (const p of requestedPaths) {
      if (!(await utils.isValidPath(p))) {
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

  const fileName = new Date().toISOString().replace(/[-:Z]/g, '');
  const encodedFileName = encodeURIComponent(fileName).replace(/%20/g, ' ');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}.zip`);

  const worker = new Worker(path.join(__dirname, '../workers/zipWorker.js'), {
    workerData: { pathList, baseDirectory: config.baseDirectory }
  });

  worker.on('message', (message) => {
    switch (message.type) {
      case 'data':
        res.write(message.chunk);
        break;

      case 'end':
        res.end();
        break;

      case 'error':
        // res.status(500).json({ error: message.error });
        res.status(500).json({ error: 'Failed to download files' });
        break;
    }
  });

  worker.on('error', (error) => {
    // res.status(500).json({ error: error.message });
    res.status(500).json({ error: 'Failed to download files' });
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      // res.status(500).json({ error: `Worker stopped with exit code ${code}` });
      res.status(500).json({ error: 'Failed to download files' });
    }
  });

  req.on('close', () => worker.terminate());
  req.on('aborted', () => worker.terminate());
});

module.exports = router;