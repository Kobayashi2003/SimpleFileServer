function handleError(fn) {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);

      if (result && typeof result.catch === 'function') {
        result.catch(error => {
          console.error('Internal server error:', error);
          res.status(500).json({ error: 'Internal server error'});
        })
      }
    } catch (error) {
      console.error('Internal server error:', error)
      res.status(500).json({ error: 'Internal server error'});
    }
  }
}

module.exports = {
  handleError
}