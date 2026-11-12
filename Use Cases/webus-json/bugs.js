'use strict';

// Phase 3: the original Webus's three privacy bugs, off unless named in
// WEBUS_BUGS (comma-separated). WEBUS_BUGS=promo,travelers,inject reproduces
// the original repo.
//
//   promo      subscribe reads tickets.e_mail and tickets.date to find frequent travelers
//   travelers  buy_ticket adds the buyer's name to schedules.travelers, and
//              GET /tickets/schedules returns it
//   inject     purchase_history builds its filter from the user's text with
//              new Function (the JSON version of Mongo's $where)
//
// Read on every request, so tests can switch flags without reloading the app.

function bugOn(name) {
  return (process.env.WEBUS_BUGS || '').split(',').map(function (flag) {
    return flag.trim();
  }).indexOf(name) !== -1;
}

module.exports = { bugOn: bugOn };
