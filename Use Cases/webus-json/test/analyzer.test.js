'use strict';

// Runs the static analyzer (Static Analysis Engine/parser) on app-single-file.js
// and checks it builds a real graph. The analyzer exits 0 even when its
// dependency builder crashes; it just writes CSVs holding only a header row.
// So this test checks the output, not the exit code.
//
// Needs the analyzer's dependencies: run `npm install` in
// "Static Analysis Engine/parser". The test is skipped when they are missing.

const path = require('path');
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { analyze, ready } = require('./helpers/analyze');

const target = path.join(__dirname, '..', 'app-single-file.js');

describe('static analyzer on app-single-file.js', { skip: ready ? false : 'run npm install in Static Analysis Engine/parser' }, () => {
  let graph;
  let names;

  before(() => {
    graph = analyze(target);
    names = new Set();
    for (const node of graph.nodes.values()) names.add(node.name);
  });

  it('does not crash', () => {
    assert.doesNotMatch(graph.output, /Error/);
  });

  it('writes a non-empty graph', () => {
    // No nodes means the dependency builder crashed.
    assert.ok(graph.nodes.size > 100, 'graph has ' + graph.nodes.size + ' nodes');
  });

  it('sees all four endpoints', () => {
    const literals = new Set();
    for (const node of graph.nodes.values()) if (node.type === 'Literal') literals.add(node.value);
    for (const route of ['/tickets/schedules', '/tickets/buy_ticket', '/tickets/purchase_history', '/newsletter/subscribe']) {
      assert.ok(literals.has(route), route + ' missing from graph');
    }
  });

  it('includes the phase 3 bug code', () => {
    for (const name of ['WEBUS_BUGS', 'travelers', 'Function', 'frequentTraveler']) {
      assert.ok(names.has(name), name + ' missing from graph');
    }
  });
});
