const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');
const { writePermissionMiddleware } = require('../middleware/auth');

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

router.post('/_mkdir', writePermissionMiddleware, handleError(async (req, res) => {
  const { path: dirPath, name: dirName} = req.query;

  if (!utils.isValidDirectoryPathSync(dirPath)) {
    return res.status(400).json({ error: 'Invalid path provided'});
  }

  const newDirPath = path.join(config.baseDirectory, dirPath, dirName);

  try {
    await fs.promises.mkdir(newDirPath, { recursive: true });
    res.status(201).json({ message: 'Directory created successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create directory' });
  }
}));

router.post('/_rename', writePermissionMiddleware, handleError(async (req, res) => {
  const { path: filePath, newName } = req.query;

}));

router.post('/_clone', writePermissionMiddleware, handleError((req, res) => {

}));

router.post('/_move', writePermissionMiddleware, handleError((req, res) => {

}));

router.delete('/_delete', writePermissionMiddleware, handleError((req, res) => {

}));

router.get('/_recyclebin', writePermissionMiddleware, handleError((req, res) => {

}));

router.post('/_recyclebin/restore', writePermissionMiddleware, handleError((req, res) => {

}));

router.delete('/_recyclebin/delete', writePermissionMiddleware, handleError((req, res) => {

}));

router.delete('/_recyclebin/empty', writePermissionMiddleware, handleError((req, res) => {

}));

module.exports = router;