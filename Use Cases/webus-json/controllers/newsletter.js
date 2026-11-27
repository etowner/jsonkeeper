// Modified for JSONKeeper from RuleKeeper's Use Cases/webus/<FILE>.
// Original: Copyright 2023 Mafalda Ferreira, Apache License 2.0
// (https://github.com/mafsbaptista/rulekeeper). See NOTICE at the repository root.
// Changes: Rewritten for the JSON file store. The original's promo bug is behind the WEBUS_BUGS promo flag.

'use strict';

// Newsletter endpoint. With no WEBUS_BUGS flags set it only
//   POST /newsletter/subscribe     writes newsletter.e_mail
// With `promo` (paper Ex 1) it also reads tickets.e_mail and tickets.date, for marketing.

const uuid = require('uuid');
const store = require('../store');
const bugOn = require('../bugs').bugOn;

const db = store.db;

module.exports = {

  subscribe(req, res) {
    const e_mail = typeof req.body.e_mail === 'string' ? req.body.e_mail.trim() : req.body.e_mail;

    if (!e_mail) {
      res.status(400).json('Missing information'); return;
    }
    if (typeof e_mail !== 'string') {
      res.status(400).json('Error subscribing to newsletter.'); return;
    }

    /* Add new e-mail to database */
    const subscription = {
      _id: uuid.v4(),
      e_mail: e_mail,
    };

    db.newsletter.push(subscription);
    store.save();

    if (!bugOn('promo')) {
      res.status(200).json({ subscribedEmail: subscription }); return;
    }

    // BUG promo: reuse ticket data for marketing. Kept faithful to the original's
    // `new Date(2020)`, which is 2020 ms after the epoch (1970), not the year 2020,
    // so every ticket counts.
    const tickets = db.tickets.filter(function (ticket) {
      return ticket.e_mail === e_mail && new Date(ticket.date) >= new Date(2020);
    });
    if (tickets.length >= 10) {
      console.log('Send Promo Code');
      res.status(200).json({ subscribedEmail: subscription, frequentTraveler: true });
    } else {
      res.status(200).json({ subscribedEmail: subscription, frequentTraveler: false });
    }
  },
};
