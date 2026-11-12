'use strict';

// Clean (bug-free) newsletter endpoint. With no WEBUS_BUGS flags set it only
//   POST /newsletter/subscribe     writes newsletter.e_mail

const uuid = require('uuid');
const store = require('../store');

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
    res.status(200).json({ subscribedEmail: subscription });
  },
};
