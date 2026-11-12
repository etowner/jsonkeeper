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
