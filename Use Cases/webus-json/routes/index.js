const express = require('express');
const path = require('path');

const router = express.Router();

/* GET home page. Static HTML in place of the original's pug view. */
router.get('/', (req, res) => {
  res.status(200);
  res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

module.exports = router;
