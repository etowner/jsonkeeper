# webus-json

Webus is a small bus-ticket Express app. This version keeps its data in a JSON
file instead of MongoDB. It is the unprotected baseline that JSONKeeper wraps:
no access controls are added, and the app's privacy bugs can be switched on
with flags.

## Endpoints

| Method | Path                        | What it does                                      | Fields touched (no bugs enabled)       |
| ------ | --------------------------- | ------------------------------------------------- | -------------------------------------- |
| GET    | `/`                         | Static home page (`views/index.html`)             | none                                   |
| GET    | `/tickets/schedules`        | Lists all schedules                               | reads `schedules.destination`, `date`  |
| POST   | `/tickets/buy_ticket`       | Creates a ticket                                  | writes `tickets.*`                     |
| GET    | `/tickets/purchase_history` | Lists a person's tickets (`?name=`)               | reads `tickets.name`, `destination`, `date` |
| POST   | `/newsletter/subscribe`     | Adds an e-mail to the newsletter                  | writes `newsletter.e_mail`             |

`buy_ticket` expects a JSON or form body with `name`, `e_mail`, `credit_card`
(digits only), `destination` and `schedule` (an ISO date such as `2026-12-01`).
Missing fields return 400 "Missing information"; invalid values return 400
"Error buying ticket."

## Layout

- `store.js`: the only module that touches the data file. It exposes
  `db.tickets`, `db.schedules` and `db.newsletter`, plus `load()`, `save()` and
  `reset()`. `save()` writes a temp file, fsyncs it, then renames it over the
  data file, so a crash mid-write leaves the old file intact. JSONKeeper is
  meant to wrap `db` here with a Proxy.
- `db.seed.json`: starting data. On first run it is copied to `data/db.json`
  (git-ignored). `reset()` restores it.
- `app.js`, `routes/`, `controllers/`: the normal layout, with `bin/www` as the
  entry point.
- `app-single-file.js`: the same app in one file, written for a static
  analyzer. It puts the full paths on one router because the analyzer reads
  the `router.get`/`router.post` literal and ignores `app.use` prefixes. `bin/www2`
  starts this version.
- `bugs.js`: reads the `WEBUS_BUGS` environment variable.
- `test/`: store, endpoint and bug tests, plus the analyzer checks described
  under [What the analyzer sees](#what-the-analyzer-sees).

## Running

```sh
npm install
npm start          # app.js on port 3000 (override with PORT)
npm run start2     # app-single-file.js instead
npm test           # node --test, Node >= 18
```

Set `WEBUS_DB` to use a different data file than `data/db.json`.

## The bug flags

The original Webus had three privacy bugs. They are off by default and turned
on with a comma-separated `WEBUS_BUGS` variable. The flags are read on every
request, so tests can change them without reloading the app.

| Flag        | Behavior when on |
| ----------- | ---------------- |
| `promo`     | `subscribe` also reads `tickets.e_mail` and `tickets.date` to flag frequent travelers (10 or more tickets). That reuses ticket data for marketing. |
| `travelers` | `buy_ticket` also appends the buyer's name to `schedules.travelers`, and `GET /tickets/schedules` returns the whole schedule, so other travelers' names leak. |
| `inject`    | `purchase_history` builds its filter from the `name` query with `new Function`, the JSON equivalent of Mongo's `$where`. Injected code can read any ticket field, including `credit_card`. |

```sh
WEBUS_BUGS=promo,travelers,inject npm start   # reproduces the original app
```

The `inject` flag runs user input as code. Use it only locally with the
seed data.

## What the analyzer sees

`test/bug-flows.test.js` runs the static analyzer on `app-single-file.js` and
lists, per route, the `store.db` fields its graph shows being read and
written. Static analysis sees every branch, so the bug code is always in the
graph, whatever `WEBUS_BUGS` is set to.

| Route | Plain app | Added by the bug code |
| ----- | --------- | --------------------- |
| GET `/tickets/schedules` | reads `schedules.destination`, `date` | `travelers`: the whole schedule (`schedules.*`) goes into the response |
| POST `/tickets/buy_ticket` | writes `tickets._id`, `name`, `e_mail`, `destination`, `date`, `credit_card` | `travelers`: reads `schedules.destination`, `date`, `travelers`; writes `schedules.travelers`; the whole schedule goes into the response |
| GET `/tickets/purchase_history` | reads `tickets.name`, `destination`, `date` | `inject`: dynamic code built from request input; whole tickets (`tickets.*`) passed to it |
| POST `/newsletter/subscribe` | writes `newsletter._id`, `e_mail` | `promo`: reads `tickets.e_mail`, `date` |

Running the same check on the phase 2 version (before the bugs) gives only
the "Plain app" column.

How it works (`test/helpers/flows.js`):

- `Static Analysis Engine/queries/rulekeeper.py` only follows
  `require('mongoose')` and model calls such as `find` and `create`, so on this
  app it finds no data operations at all. `flows.js` does the same job for
  `store.db`, reading the analyzer's CSV output directly. It does not need neo4j.
- The collections come from the analyzer's PDG: the `LOOKUP` edges out of the
  object created for `const db = store.db`.
- The rest follows the analyzer's normalized AST, resolving names by scope.
  The PDG has no edge from `v = db.tickets` to the `v.filter` after it, none for
  a variable assigned later (`matches = ...`), and it does not tie a
  `.filter(function (ticket) {...})` callback's parameter to its collection.

Known limits:

- `buy_ticket` writes `schedules.travelers` inside `if (trip) { ... }`. The
  braces are needed: in a brace-less `if` the normalizer keeps only the first
  statement it splits the body into, so the push would be dropped from the
  graph. `test/bug-flows.test.js` checks both the write and that quirk.
- For `inject`, static analysis shows whole tickets reaching code built from
  the request, but not which fields an injected string would read, such as
  `credit_card`.

## Notes

- The analyzer crashes on `.test()` called on a regex constant, so the code
  uses inline regexes only.
- It crashes the same way on a call or property read on a value set by `||`,
  such as `(process.env.WEBUS_BUGS || '').split(',')`. Store
  `obj.prop` in a `const` and test that instead.
- The analyzer exits 0 even when it crashes, writing CSVs with only a header
  row. `test/analyzer.test.js` runs it on `app-single-file.js` and checks the
  graph. Run `npm install` in `Static Analysis Engine/parser` first, or the
  analyzer tests are skipped.
- In an `if` with no braces, the normalizer keeps only the first statement it
  splits the body into. Use braces when the body is more than one simple step.
- `store.js` must stay parseable by Esprima 4.0.1: no `?.`, `??`, object
  spread, or rest in destructuring.
