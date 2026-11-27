// Modified for JSONKeeper from RuleKeeper's Use Cases/webus/<FILE>.
// Original: Copyright 2023 Mafalda Ferreira, Apache License 2.0
// (https://github.com/mafsbaptista/rulekeeper). See NOTICE at the repository root.
// Changes: Serves the static views/index.html instead of rendering the pug view, and the cookie helpers are removed.

const express = require('express');
const path = require('path');

const router = express.Router();

/* GET home page. Static HTML in place of the original's pug view. */
router.get('/', (req, res) => {
  res.status(200);
  res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

module.exports = router;
