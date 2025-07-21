const config = require('../config');
const utils = require('../utils');
const { handleError } = require('../wapper/errorHandler');
const { writePermissionMiddleware } = require('../middleware/auth');

const express = require('express');
const router = express.Router();

router.post('/_mkdir', writePermissionMiddleware, handleError((req, res) => {

}));

router.post('/_rename', writePermissionMiddleware, handleError((req, res) => {

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