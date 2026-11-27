// Modified for JSONKeeper from RuleKeeper's Use Cases/webus/<FILE>.
// Original: Copyright 2023 Mafalda Ferreira, Apache License 2.0
// (https://github.com/mafsbaptista/rulekeeper). See NOTICE at the repository root.
// Changes:Uses the JSON file store instead of Mongoose, and RuleKeeper's middleware is removed.

const express = require('express');
const cookieParser = require('cookie-parser')

// Requiring the routes loads the controllers, which load store.js and the data.
const indexRouter = require('./routes');
const ticketRouter = require('./routes/tickets');
const newsletterRouter = require('./routes/newsletter');

const app = express();

app.use(cookieParser())
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/', indexRouter);
app.use('/tickets', ticketRouter);
app.use('/newsletter', newsletterRouter);

module.exports = app;
