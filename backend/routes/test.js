const express = require('express');
const router = express.Router();

router.get('/test-async', async (req, res) => {
  // Simulate async operation

  await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds

  return res.json({ message: 'Test async route' });
});

router.get('/test-sync', (req, res) => {
  // Simulate sync operation

  const date = new Date();

  while (new Date() - date < 10000) { // 10 seconds
    // Do some work
  }

  return res.json({ message: 'Test sync route' });
});

module.exports = router;
