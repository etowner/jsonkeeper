'use strict';

// Runs the static analyzer (Static Analysis Engine/parser) on one file and
// loads the CSV graph it writes. The analyzer exits 0 even when it crashes, so
// callers check `output` and the node count, not the exit code.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PARSER_DIR = path.join(__dirname, '..', '..', '..', '..', 'Static Analysis Engine', 'parser');
const PARSER = path.join(PARSER_DIR, 'parser.js');

// The analyzer's dependencies are installed separately (npm install in PARSER_DIR).
const ready = fs.existsSync(path.join(PARSER_DIR, 'node_modules', 'esprima'));

// CSV fields are separated by U+00BF, with a header row.
function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').slice(1)
    .filter(function (line) { return line !== ''; })
    .map(function (line) { return line.split('¿'); });
}

function analyze(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webus-json-analyzer-'));
  try {
    fs.mkdirSync(path.join(dir, 'graphs'));
    const run = spawnSync(process.execPath, [PARSER, file, '--csv'], { cwd: dir, encoding: 'utf8' });

    const nodes = new Map();
    for (const [id, type, name, value] of readCsv(path.join(dir, 'graphs', 'graph_nodes.csv'))) {
      nodes.set(id, { id, type, name, value });
    }
    const edges = readCsv(path.join(dir, 'graphs', 'graph_rels.csv'))
      .map(function ([from, to, label, type, name, index]) {
        return { from, to, label, type, name, index };
      });

    return { output: (run.stdout || '') + (run.stderr || ''), nodes, edges };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { analyze, ready, PARSER_DIR };
