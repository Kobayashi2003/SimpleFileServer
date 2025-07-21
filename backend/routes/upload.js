const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');
const { writePermissionMiddleware } = require('../middleware/auth');

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const express = require('express');
const router = express.Router();

router.post('/_upload', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;

  if (!utils.isValidPath(dir, isDirectory=true)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const uploadPath = path.join(config.baseDirectory, dir);



});

router.post('/_upload-folder', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;

  if (!utils.isValidPath(dir, isDirectory=true)) {
    return res.status(400).json({ error: 'Invalid path provided' });
  }

  const uploadPath = path.join(config.baseDirectory, dir);



});

module.exports = router;