'use strict';

// Clean (bug-free) ticket endpoints. Phase 3 adds the original's bugs behind
// WEBUS_BUGS flags; with no flags set, each endpoint touches only:
//   GET  /tickets/schedules        reads schedules.destination, date
//   POST /tickets/buy_ticket       writes tickets.*
//   GET  /tickets/purchase_history reads tickets.name, destination, date

const uuid = require('uuid');
const store = require('../store');

const db = store.db;

// Mongoose trimmed these fields in the original schemas.
function trim(value) {
  return typeof value === 'string' ? value.trim() : value;
}

// "2026-12-01" only, and a real calendar day: V8 turns "2026-02-30" into March 2.
// The round trip checks both. (No regex constants here or in app-single-file.js:
// the analyzer crashes on `CONST.test(x)`; an inline regex is fine.)
function isIsoDate(value) {
  return typeof value === 'string' && !isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

module.exports = {

  seeSchedules(req, res) {
    // Return all schedules from all time, without the travelers list
    const schedules = db.schedules.map(function (schedule) {
      return { destination: schedule.destination, date: schedule.date };
    });
    res.status(200).json(schedules);
  },

  buyTicket(req, res) {
    const name = trim(req.body.name);
    const e_mail = trim(req.body.e_mail);
    const credit_card = req.body.credit_card;
    const destination = trim(req.body.destination);
    const schedule = req.body.schedule;

    if (!name || !e_mail || !credit_card || !destination || !schedule) {
      res.status(400).json('Missing information'); return;
    }

    // The original rejected these through Mongoose casting errors.
    const cardText = String(credit_card);
    if (typeof name !== 'string' || typeof e_mail !== 'string' || typeof destination !== 'string' ||
        !isIsoDate(schedule) || !/^\d+$/.test(cardText)) {
      res.status(400).json('Error buying ticket.'); return;
    }

    /* Add new ticket to database */
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
  },

  seePurchaseHistory(req, res) {
    const name = req.query.name;

    // Plain equality filter on name; return only name, destination and date
    const tickets = db.tickets.filter(function (ticket) {
      return ticket.name === name;
    }).map(function (ticket) {
      return { name: ticket.name, destination: ticket.destination, date: ticket.date };
    });
    res.status(200).json(tickets);
  },
};
