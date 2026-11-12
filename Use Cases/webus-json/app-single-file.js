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
//
// Phase 3 bug flags (WEBUS_BUGS=promo,travelers,inject) work as in bugs.js.
// The inject bug's syntax errors reach the error handler at the bottom
// instead of a try block, which the analyzer would drop.

const express = require('express');
const cookieParser = require('cookie-parser');
const uuid = require('uuid');
const store = require('./store');

const db = store.db;

function trim(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function bugOn(name) {
  return (process.env.WEBUS_BUGS || '').split(',').map(function (flag) {
    return flag.trim();
  }).indexOf(name) !== -1;
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
  if (bugOn('travelers')) {
    res.status(200).json(db.schedules); return;
  }

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

  if (!bugOn('travelers')) {
    store.save();
    res.status(200).json({ createdTicket: ticket }); return;
  }

  const trip = db.schedules.filter(function (s) {
    return s.destination === destination && s.date === schedule;
  })[0];
  const updatedSchedule = trip ? JSON.parse(JSON.stringify(trip)) : null;
  if (trip) trip.travelers.push(name);
  store.save();
  res.status(200).json({ createdTicket: ticket, updatedSchedule: updatedSchedule });
});

router.get('/tickets/purchase_history', function (req, res) {
  const name = req.query.name;

  let matches;
  if (bugOn('inject')) {
    const where = new Function("return this.name === '" + name + "'");
    matches = db.tickets.filter(function (ticket) { return where.call(ticket); });
  } else {
    matches = db.tickets.filter(function (ticket) {
      return ticket.name === name;
    });
  }

  const tickets = matches.map(function (ticket) {
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

  if (!bugOn('promo')) {
    res.status(200).json({ subscribedEmail: subscription }); return;
  }

  const tickets = db.tickets.filter(function (ticket) {
    return ticket.e_mail === e_mail && new Date(ticket.date) >= new Date(2020);
  });
  if (tickets.length >= 10) {
    console.log('Send Promo Code');
    res.status(200).json({ subscribedEmail: subscription, frequentTraveler: true });
  } else {
    res.status(200).json({ subscribedEmail: subscription, frequentTraveler: false });
  }
});

app.use(router);

// Only the inject bug throws: its filter code can fail to compile or run.
app.use('/tickets/purchase_history', function (err, req, res, next) {
  res.status(400).json('Error fetching ticket history.');
});

module.exports = app;
