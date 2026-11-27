'use strict';

// Step 2: does the analyzer's graph show the phase 3 privacy bugs? Runs the
// analyzer on app-single-file.js and checks, per route, the store.db fields it
// shows being read and written (see helpers/flows.js for how).
//
// Static analysis sees every branch, so the bug code is always in the graph,
// whatever WEBUS_BUGS is set to. Each expected entry is tagged with where it
// comes from: the plain app, or one of the bug flags.
//
// Needs the analyzer's dependencies: run `npm install` in
// "Static Analysis Engine/parser". The test is skipped when they are missing.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { analyze, ready } = require('./helpers/analyze');
const { findFlows } = require('./helpers/flows');

const target = path.join(__dirname, '..', 'app-single-file.js');

const EXPECTED = {
  'GET /tickets/schedules': {
    reads: {
      'schedules.destination': 'baseline',
      'schedules.date': 'baseline',
      'schedules.*': 'travelers',
    },
    writes: {},
    flags: {
      'schedules.* in response': 'travelers',
    },
  },
  'POST /tickets/buy_ticket': {
    reads: {
      'schedules.destination': 'travelers',
      'schedules.date': 'travelers',
      'schedules.travelers': 'travelers',
      'schedules.*': 'travelers',
    },
    writes: {
      'tickets._id': 'baseline',
      'tickets.name': 'baseline',
      'tickets.e_mail': 'baseline',
      'tickets.destination': 'baseline',
      'tickets.date': 'baseline',
      'tickets.credit_card': 'baseline',
      'schedules.travelers': 'travelers',
    },
    flags: {
      'schedules.* in response': 'travelers',
    },
  },
  'GET /tickets/purchase_history': {
    reads: {
      'tickets.name': 'baseline',
      'tickets.destination': 'baseline',
      'tickets.date': 'baseline',
      'tickets.*': 'inject',
    },
    writes: {},
    flags: {
      'dynamic code built from request input': 'inject',
      'tickets.* passed to dynamic code': 'inject',
    },
  },
  'POST /newsletter/subscribe': {
    reads: {
      'tickets.e_mail': 'promo',
      'tickets.date': 'promo',
    },
    writes: {
      'newsletter._id': 'baseline',
      'newsletter.e_mail': 'baseline',
    },
    flags: {},
  },
};

const sorted = (set) => Array.from(set).sort();

describe('bug flows in the analyzer graph', { skip: ready ? false : 'run npm install in Static Analysis Engine/parser' }, () => {
  let flows;

  before(() => {
    flows = findFlows(analyze(target));
  });

  it('finds exactly the four routes', () => {
    assert.deepStrictEqual(Object.keys(flows).sort(), Object.keys(EXPECTED).sort());
  });

  for (const [route, expected] of Object.entries(EXPECTED)) {
    describe(route, () => {
      for (const kind of ['reads', 'writes', 'flags']) {
        it(kind, () => {
          assert.deepStrictEqual(sorted(flows[route][kind]), Object.keys(expected[kind]).sort());
        });
      }
    });
  }

  // Why `if (trip) { ... }` has braces: in a brace-less `if` the normalizer keeps
  // only the first statement it splits the body into (`v = trip.travelers`), so
  // the push vanishes from the graph. If this starts failing, the analyzer has
  // been fixed and the braces are no longer required.
  it('travelers: without braces the analyzer drops the push', () => {
    const source = fs.readFileSync(target, 'utf8');
    const braced = '  if (trip) { trip.travelers.push(name); }\n';
    assert.ok(source.includes(braced), 'app-single-file.js no longer has the braced travelers line');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webus-json-nobraces-'));
    try {
      const file = path.join(dir, 'app-single-file.js');
      fs.writeFileSync(file, source.replace(braced, '  if (trip) trip.travelers.push(name);\n'));
      const writes = findFlows(analyze(file))['POST /tickets/buy_ticket'].writes;
      assert.ok(writes.has('tickets.name'), 'variant was not analyzed');
      assert.ok(!writes.has('schedules.travelers'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The inject bug runs code built from the request. Static analysis can show
  // that whole tickets reach that code, but not which fields an injected string
  // would read, such as credit_card. This pins that limit so nobody assumes more.
  it('inject: credit_card is only covered by tickets.*, not read by name', () => {
    const history = flows['GET /tickets/purchase_history'];
    assert.ok(history.reads.has('tickets.*'));
    assert.ok(!history.reads.has('tickets.credit_card'));
  });
});
