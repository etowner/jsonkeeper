'use strict';

// The only module that touches the data file. Controllers use `db.<collection>`
// (db.tickets, db.schedules, db.newsletter) and call save() after a write.
// JSONKeeper will wrap `db` in a Proxy here, so keep all data access going through it.
//
// Keep this file parseable by Esprima 4.0.1: no `?.`, `??`, object spread or
// rest in destructuring.

const fs = require('fs');
const path = require('path');

const SEED_FILE = path.join(__dirname, 'db.seed.json');
const DATA_FILE = process.env.WEBUS_DB || path.join(__dirname, 'data', 'db.json');

// Never reassigned: load() and reset() swap its contents, so every module that
// required `db` keeps seeing the current data.
const db = {};

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function replaceContents(data) {
  Object.keys(db).forEach(function (name) { delete db[name]; });
  Object.keys(data).forEach(function (name) { db[name] = data[name]; });
}

// Write to a temp file, flush it to disk, then rename over the data file.
// The rename is atomic, so a crash mid-write leaves the old file intact.
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(db, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DATA_FILE);
}

// Restore the seed data. Tests call this before each run.
function reset() {
  replaceContents(readJson(SEED_FILE));
  save();
  return db;
}

// Read the data file into `db`, starting from the seed on first run.
function load() {
  if (!fs.existsSync(DATA_FILE)) return reset();
  replaceContents(readJson(DATA_FILE));
  return db;
}

load();

module.exports = { db: db, load: load, save: save, reset: reset, DATA_FILE: DATA_FILE };
