const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');
const { writePermissionMiddleware } = require('../middleware/auth');

const express = require('express');
const router = express.Router();

router.get('/_index-status', writePermissionMiddleware, handleError((req, res) => {

}));

router.post('/_rebuild-index', writePermissionMiddleware, handleError((req, res) => {

}));

router.get('/_watcher-status', writePermissionMiddleware, handleError((req, res) => {

}));

router.post('/_toggle-watcher', writePermissionMiddleware, handleError((req, res) => {

}));

module.exports = router;