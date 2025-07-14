const config = require('../config');
const { writePermissionMiddleware } = require('./middleware/auth');

const express = require('express');
const router = express.Router();

router.post('/upload', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;
});

router.post('/upload-folder', writePermissionMiddleware, (req, res) => {
  const { dir = '' } = req.query;
});