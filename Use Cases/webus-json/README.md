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
- `test/`: store, endpoint and bug tests.

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

## Notes

- The analyzer crashes on `.test()` called on a regex constant, so the code
  uses inline regexes only.
- `store.js` must stay parseable by Esprima 4.0.1: no `?.`, `??`, object
  spread, or rest in destructuring.
