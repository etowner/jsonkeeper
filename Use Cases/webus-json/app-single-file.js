// All four endpoints in one file, for the static analyzer. Behaves the same as
// app.js (test/endpoints.test.js runs against both), so keep the two in sync.
//
// Written for the analyzer (Static Analysis Engine/parser):
// - Full paths on one router: it reads the endpoint from the router.get/post
//   literal and ignores app.use prefixes.
// - Inline function callbacks, and no template literals, for loops, try,
//   switch or spread: its normalizer silently drops those nodes.
// - No regex constants: `CONST.test(x)` crashes its dependency builder, and
//   parser.js catches the crash and writes an empty graph. Inline regexes are fine.

const express = require('express');
const cookieParser = require('cookie-parser');
const uuid = require('uuid');
const store = require('./store');

const db = store.db;

function trim(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function isIsoDate(value) {
  return typeof value === 'string' && !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

const app = express();
const router = express.Router();

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

router.get('/tickets/schedules', function (req, res) {
  const schedules = db.schedules.map(function (schedule) {
    return { destination: schedule.destination, date: schedule.date };
  });
  res.status(200).json(schedules);
});

router.post('/tickets/buy_ticket', function (req, res) {
  const name = trim(req.body.name);
  const e_mail = trim(req.body.e_mail);
  const credit_card = req.body.credit_card;
  const destination = trim(req.body.destination);
  const schedule = req.body.schedule;

  if (!name || !e_mail || !credit_card || !destination || !schedule) {
    res.status(400).json('Missing information'); return;
  }

  const cardText = String(credit_card);
  if (typeof name !== 'string' || typeof e_mail !== 'string' || typeof destination !== 'string' ||
      !isIsoDate(schedule) || !/^\d+$/.test(cardText)) {
    res.status(400).json('Error buying ticket.'); return;
  }

  const ticket = {
    _id: uuid.v4(),
    name: name,
    e_mail: e_mail,
    destination: destination,
    date: schedule,
    credit_card: cardText,
  };

  db.tickets.push(ticket);
  store.save();
  res.status(200).json({ createdTicket: ticket });
});

router.get('/tickets/purchase_history', function (req, res) {
  const name = req.query.name;

  const tickets = db.tickets.filter(function (ticket) {
    return ticket.name === name;
  }).map(function (ticket) {
    return { name: ticket.name, destination: ticket.destination, date: ticket.date };
  });
  res.status(200).json(tickets);
});

router.post('/newsletter/subscribe', function (req, res) {
  const e_mail = trim(req.body.e_mail);

  if (!e_mail) {
    res.status(400).json('Missing information'); return;
  }
  if (typeof e_mail !== 'string') {
    res.status(400).json('Error subscribing to newsletter.'); return;
  }

  const subscription = {
    _id: uuid.v4(),
    e_mail: e_mail,
  };

  db.newsletter.push(subscription);
  store.save();
  res.status(200).json({ subscribedEmail: subscription });
});

app.use(router);

module.exports = app;
