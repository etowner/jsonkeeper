// Modified for JSONKeeper from RuleKeeper's Use Cases/webus/<FILE>.
// Original: Copyright 2023 Mafalda Ferreira, Apache License 2.0
// (https://github.com/mafsbaptista/rulekeeper). See NOTICE at the repository root.
// Changes: Rewritten for the JSON file store.
//  The original's travelers and injection bugs are behind the WEBUS_BUGS travelers and inject flags.

'use strict';

// Ticket endpoints. With no WEBUS_BUGS flags set, each endpoint touches only:
//   GET  /tickets/schedules        reads schedules.destination, date
//   POST /tickets/buy_ticket       writes tickets.*
//   GET  /tickets/purchase_history reads tickets.name, destination, date
// The original's bugs (see bugs.js):
//   travelers (paper Ex 2) buy_ticket also writes schedules.travelers, and
//                          schedules returns whole schedules, travelers included
//   inject    (paper Ex 3) purchase_history runs the user's text as code, which
//                          can read any ticket field, credit_card included

const uuid = require('uuid');
const store = require('../store');
const bugOn = require('../bugs').bugOn;

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
    // BUG travelers: the original returned whole schedules, travelers included
    if (bugOn('travelers')) {
      res.status(200).json(db.schedules); return;
    }

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

    if (!bugOn('travelers')) {
      store.save();
      res.status(200).json({ createdTicket: ticket }); return;
    }

    /* BUG travelers: add new traveler to trip. Like Mongoose's findOneAndUpdate,
       answer with the schedule as it was before the update, or null if none matched. */
    const trip = db.schedules.filter(function (s) {
      return s.destination === destination && s.date === schedule;
    })[0];
    const updatedSchedule = trip ? JSON.parse(JSON.stringify(trip)) : null;
    if (trip) { trip.travelers.push(name); }
    store.save();
    res.status(200).json({ createdTicket: ticket, updatedSchedule: updatedSchedule });
  },

  seePurchaseHistory(req, res) {
    const name = req.query.name;

    // BUG inject: the original's {$where: "this.name === '" + name + "'"}
    // run as JavaScript with each ticket as `this`. The projection still hides
    // credit_card, but injected code can read it and leak it one guess at a time.
    let matches;
    if (bugOn('inject')) {
      try {
        const where = new Function("return this.name === '" + name + "'");
        matches = db.tickets.filter(function (ticket) { return where.call(ticket); });
      } catch (err) {
        res.status(400).json('Error fetching ticket history.'); return;
      }
    } else {
      // Plain equality filter on name
      matches = db.tickets.filter(function (ticket) {
        return ticket.name === name;
      });
    }

    // Return only name, destination and date
    const tickets = matches.map(function (ticket) {
      return { name: ticket.name, destination: ticket.destination, date: ticket.date };
    });
    res.status(200).json(tickets);
  },
};
