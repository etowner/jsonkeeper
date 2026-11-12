'use strict';

// Phase 1 "done when": saving and reloading the data gives back the same data.

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

// Point the store at a throwaway file before requiring it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webus-json-'));
process.env.WEBUS_DB = path.join(dir, 'db.json');
const store = require('../store');

const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.seed.json'), 'utf8'));
const onDisk = () => JSON.parse(fs.readFileSync(store.DATA_FILE, 'utf8'));
const plain = (o) => JSON.parse(JSON.stringify(o));

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test.beforeEach(() => store.reset());

test('first load starts from the seed data', () => {
  assert.deepStrictEqual(plain(store.db), seed);
  assert.deepStrictEqual(onDisk(), seed);
});

test('seed data follows the plan', () => {
  assert.deepStrictEqual(Object.keys(seed).sort(), ['newsletter', 'schedules', 'tickets']);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  seed.tickets.forEach((t) => {
    assert.match(t.date, iso);
    assert.strictEqual(typeof t.credit_card, 'string');
    assert.ok(t.e_mail, 'every ticket has an e_mail owner');
  });
  seed.schedules.forEach((s) => {
    assert.match(s.date, iso);
    assert.deepStrictEqual(s.travelers, []);
  });
});

test('save then load gives back the same data', () => {
  store.db.tickets.push({
    _id: 'test-ticket', name: 'Maria Silva', e_mail: 'maria.silva@example.com',
    destination: 'Porto', date: '2026-12-01', credit_card: '0004111111111111',
  });
  store.db.newsletter.push({ _id: 'test-sub', e_mail: 'maria.silva@example.com' });
  store.save();
  const expected = plain(store.db);

  store.db.tickets.length = 0; // scribble on memory; load() must restore from disk
  store.load();

  assert.deepStrictEqual(plain(store.db), expected);
  assert.deepStrictEqual(onDisk(), expected);
  // String card numbers survive with leading zeros intact.
  assert.strictEqual(store.db.tickets[store.db.tickets.length - 1].credit_card, '0004111111111111');
});

test('db keeps the same object identity across load and reset', () => {
  const ref = store.db;
  store.load();
  assert.strictEqual(store.db, ref);
  store.reset();
  assert.strictEqual(store.db, ref);
});

test('reset restores the seed after writes', () => {
  store.db.newsletter.push({ _id: 'x', e_mail: 'x@example.com' });
  store.save();
  store.reset();
  assert.deepStrictEqual(plain(store.db), seed);
  assert.deepStrictEqual(onDisk(), seed);
});

test('save leaves no temp file behind', () => {
  store.save();
  assert.ok(!fs.existsSync(store.DATA_FILE + '.tmp'));
});
