const config = require('../config');
const { validateUser, createSession, getSession, deleteSession } = require('../middleware/auth');

const express = require('express');
const router = express.Router();

router.post('/login', (req, res) => {
  const { username: _username, password: _password } = req.body;

  if (typeof _username !== 'string' || typeof _password !== 'string') {
    return res.status(400).json({ error: 'Username and password must be strings' });
  }

  const username = _username.trim();
  const password = _password;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const userStatus = validateUser(username, password);

  if (!userStatus.isAuthenticated) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionId = createSession(userStatus.username, userStatus.permissions);

  res.cookie('sessionId', sessionId, {
    httpOnly: true,        // prevent XSS attacks
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict',    // prevent CSRF attacks
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  });

  res.json({
    success: true,
    username: userStatus.username,
    permissions: userStatus.permissions
  });
});

router.post('/logout', (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    deleteSession(sessionId);
  }

  res.clearCookie('sessionId');

  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('validate-session', (req, res) => {
  if (!config.userRules || config.userRules.length === 0) {
    return res.json({
      isAuthenticated: true,
      username: null,
      permissions: 'rw'
    });
  }

  const sessionId = req.cookies.sessionId;
  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return res.json({
        isAuthenticated: true,
        username: session.username,
        permissions: session.permissions
      });
    }
  }

  return res.json({
    isAuthenticated: false,
    username: null,
    permissions: null
  });
});

module.exports = router;