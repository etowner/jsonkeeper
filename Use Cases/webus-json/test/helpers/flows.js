'use strict';

// Works out, per Express route, which store.db fields the analyzer's graph shows
// being read and written. It does for store.db what
// "Static Analysis Engine/queries/rulekeeper.py" does for mongoose models; that
// script only follows require('mongoose'), so it finds nothing in this app.
//
// It works on the CSV graph from ./analyze, since neo4j is not needed for this.
//
// What comes from the analyzer and what this file adds:
// - Collections: taken from the analyzer's PDG, as the LOOKUP edges out of the
//   object it creates for `const db = store.db`.
// - Everything else follows the analyzer's normalized AST (one operation per
//   statement), resolving names by scope. The PDG cannot be used for this part:
//   it has no edge from `v = db.tickets` to the `v.filter` that follows, none for
//   a variable assigned later (`matches = ...`), and it does not tie a
//   `.filter(function (ticket) {...})` callback's parameter to the collection.
// - Scope is AST containment in the route's callback, so nested callbacks count.
//   (rulekeeper.py uses CFG reachability, which stops at nested functions.)
//
// Result: { 'GET /path': { reads: Set, writes: Set, flags: Set } }, where reads
// and writes hold 'collection.field', and 'collection.*' means the whole record.

const ROUTE_METHODS = ['get', 'post', 'put', 'delete'];
const ELEMENT_METHODS = ['filter', 'find', 'map', 'forEach', 'some', 'every'];
const WRITE_METHODS = ['push', 'unshift'];

function buildIndex(graph) {
  const ast = new Map();
  for (const edge of graph.edges) {
    if (edge.label !== 'AST') continue;
    if (!ast.has(edge.from)) ast.set(edge.from, []);
    ast.get(edge.from).push(edge);
  }
  const kids = function (id) { return ast.get(id) || []; };
  const child = function (id, type) {
    const edge = kids(id).find(function (e) { return e.type === type; });
    return edge ? edge.to : null;
  };
  const args = function (id) {
    return kids(id).filter(function (e) { return e.type === 'arg'; })
      .sort(function (a, b) { return Number(a.index) - Number(b.index); })
      .map(function (e) { return e.to; });
  };
  const node = function (id) { return graph.nodes.get(id); };

  // Declarations that the PDG shows reading a collection off store.db.
  const collectionDecls = new Map();
  const storeDbObjects = new Set();
  for (const edge of graph.edges) {
    if (edge.label === 'OBJECT' && edge.type === 'CREATE' && edge.name === 'store.db') storeDbObjects.add(edge.to);
  }
  for (const edge of graph.edges) {
    if (edge.label === 'PDG' && edge.type === 'LOOKUP' && storeDbObjects.has(edge.from)) {
      collectionDecls.set(edge.to, edge.name);
    }
  }

  return { kids, child, args, node, collectionDecls };
}

const OTHER = { kind: 'other', tainted: false };
const other = function (tainted) { return tainted ? { kind: 'other', tainted: true } : OTHER; };
const holdsData = function (v) { return v && (v.kind === 'coll' || v.kind === 'elem'); };

function findFlows(graph) {
  const g = buildIndex(graph);
  const routes = {};

  // Program-level declarations: name -> init node id.
  const topDecls = new Map();
  for (const edge of g.kids('0')) {
    const n = g.node(edge.to);
    if (n.type === 'VariableDeclarator') topDecls.set(n.name, g.child(n.id, 'init'));
  }
  const initOf = function (name) { return topDecls.get(name); };

  // router = express.Router()
  const isRouter = function (name) {
    const init = initOf(name);
    if (!init || g.node(init).type !== 'CallExpression') return false;
    const callee = g.node(g.child(init, 'callee'));
    if (!callee || callee.type !== 'Identifier') return false;
    const member = initOf(callee.name);
    if (!member || g.node(member).type !== 'MemberExpression') return false;
    return g.node(g.child(member, 'object')).name === 'express' &&
      g.node(g.child(member, 'property')).name === 'Router';
  };

  for (const edge of g.kids('0')) {
    const stmt = g.node(edge.to);
    if (stmt.type !== 'ExpressionStatement') continue;
    const call = g.child(stmt.id, 'expression');
    if (g.node(call).type !== 'CallExpression') continue;
    const callee = g.node(g.child(call, 'callee'));
    const member = callee && callee.type === 'Identifier' ? initOf(callee.name) : null;
    if (!member || g.node(member).type !== 'MemberExpression') continue;
    const method = g.node(g.child(member, 'property')).name;
    const obj = g.node(g.child(member, 'object'));
    if (ROUTE_METHODS.indexOf(method) === -1 || !isRouter(obj.name)) continue;

    const [pathArg, handlerArg] = g.args(call);
    if (!pathArg || !handlerArg || g.node(pathArg).type !== 'Literal') continue;
    const fn = initOf(g.node(handlerArg).name);
    if (!fn || g.node(fn).type !== 'FunctionExpression') continue;

    routes[method.toUpperCase() + ' ' + g.node(pathArg).value] = analyzeRoute(g, fn, topDecls);
  }
  return routes;
}

function analyzeRoute(g, fnId, topDecls) {
  const reads = new Set();
  const writes = new Set();
  const flags = new Set();

  const makeScope = function (parent) { return { vars: new Map(), parent }; };
  const lookup = function (scope, name) {
    for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
    return undefined;
  };

  // The whole record reaches a sink: a response or dynamic code.
  const expose = function (value, flag) {
    if (holdsData(value)) {
      reads.add(value.coll + '.*');
      flags.add(value.coll + '.* ' + flag);
    } else if (value && value.kind === 'obj') {
      for (const v of value.props.values()) expose(v, flag);
    }
  };

  const top = makeScope(null);
  for (const [name, init] of topDecls) {
    if (init && g.node(init).type === 'MemberExpression' &&
        g.node(g.child(init, 'object')).name === 'store' &&
        g.node(g.child(init, 'property')).name === 'db') {
      top.vars.set(name, { kind: 'db' });
    }
  }

  function memberName(id) {
    const prop = g.node(g.child(id, 'property'));
    return prop.type === 'Literal' ? prop.value : prop.name;
  }

  function evaluate(id, scope) {
    if (!id) return OTHER;
    const n = g.node(id);
    switch (n.type) {
      case 'Identifier': {
        const v = lookup(scope, n.name);
        return v === undefined ? OTHER : v;
      }
      case 'MemberExpression': {
        const obj = evaluate(g.child(id, 'object'), scope);
        const prop = memberName(id);
        if (obj.kind === 'db') return { kind: 'coll', coll: prop };
        if (obj.kind === 'req') return other(true);
        if (obj.kind === 'res') return prop === 'json' || prop === 'send' ? { kind: 'sink' } : { kind: 'res' };
        if (obj.kind === 'dyn' && (prop === 'call' || prop === 'apply')) return { kind: 'dyncall' };
        if (obj.kind === 'coll') {
          if (/^\d+$/.test(prop)) return { kind: 'elem', coll: obj.coll };
          return { kind: 'method', recv: obj, name: prop };
        }
        if (obj.kind === 'elem') {
          reads.add(obj.coll + '.' + prop);
          return { kind: 'field', coll: obj.coll, field: prop };
        }
        if (obj.kind === 'field') return { kind: 'method', recv: obj, name: prop };
        if (obj.kind === 'json') return { kind: 'passthrough' };
        return other(obj.tainted);
      }
      case 'CallExpression': {
        const callee = evaluate(g.child(id, 'callee'), scope);
        const argIds = g.args(id);
        const argVals = argIds.map(function (a) { return evaluate(a, scope); });
        return call(callee, argIds, argVals, scope);
      }
      case 'NewExpression': {
        const callee = g.node(g.child(id, 'callee'));
        const argVals = g.args(id).map(function (a) { return evaluate(a, scope); });
        if (callee.type === 'Identifier' && callee.name === 'Function') {
          if (argVals.some(function (v) { return v.tainted; })) flags.add('dynamic code built from request input');
          return { kind: 'dyn' };
        }
        return other(argVals.some(function (v) { return v.tainted; }));
      }
      case 'BinaryExpression':
      case 'LogicalExpression': {
        const l = evaluate(g.child(id, 'left'), scope);
        const r = evaluate(g.child(id, 'right'), scope);
        if (n.type === 'LogicalExpression' && holdsData(l)) return l;
        if (n.type === 'LogicalExpression' && holdsData(r)) return r;
        return other(l.tainted || r.tainted);
      }
      case 'ConditionalExpression': {
        evaluate(g.child(id, 'test'), scope);
        const a = evaluate(g.child(id, 'then'), scope);
        const b = evaluate(g.child(id, 'else'), scope);
        return holdsData(a) ? a : b;
      }
      case 'UnaryExpression':
        return other(evaluate(g.child(id, 'argument'), scope).tainted);
      case 'ObjectExpression': {
        const props = new Map();
        for (const e of g.kids(id)) {
          const p = g.node(e.to);
          if (p.type !== 'Property') continue;
          props.set(g.node(g.child(p.id, 'key')).name, evaluate(g.child(p.id, 'computed'), scope));
        }
        return { kind: 'obj', props };
      }
      case 'FunctionExpression':
        return { kind: 'fn', id, scope };
      default:
        return OTHER;
    }
  }

  function call(callee, argIds, argVals, scope) {
    const tainted = argVals.some(function (v) { return v.tainted; });

    if (callee.kind === 'method' && callee.recv.kind === 'coll') {
      const coll = callee.recv.coll;
      if (ELEMENT_METHODS.indexOf(callee.name) !== -1) {
        if (argVals[0] && argVals[0].kind === 'fn') runFunction(argVals[0], [{ kind: 'elem', coll }]);
        if (callee.name === 'filter') return { kind: 'coll', coll };
        if (callee.name === 'find') return { kind: 'elem', coll };
        return OTHER;
      }
      if (WRITE_METHODS.indexOf(callee.name) !== -1) {
        const record = argVals[0];
        if (record && record.kind === 'obj' && record.props.size > 0) {
          for (const field of record.props.keys()) writes.add(coll + '.' + field);
        } else {
          writes.add(coll + '.*');
        }
      }
      return OTHER;
    }
    if (callee.kind === 'method' && callee.recv.kind === 'field' && WRITE_METHODS.indexOf(callee.name) !== -1) {
      writes.add(callee.recv.coll + '.' + callee.recv.field);
      return OTHER;
    }
    if (callee.kind === 'sink') {
      argVals.forEach(function (v) { expose(v, 'in response'); });
      return OTHER;
    }
    if (callee.kind === 'dyncall' || callee.kind === 'dyn') {
      argVals.forEach(function (v) { expose(v, 'passed to dynamic code'); });
      return other(true);
    }
    if (callee.kind === 'res') return { kind: 'res' };
    // JSON.parse / JSON.stringify keep the data they are given.
    if (callee.kind === 'passthrough') return argVals[0] || OTHER;
    return other(tainted);
  }

  function runFunction(fn, params, isRoute) {
    const scope = makeScope(fn.scope);
    const paramIds = g.kids(fn.id).filter(function (e) { return e.type === 'param'; }).map(function (e) { return e.to; });
    paramIds.forEach(function (p, i) {
      const name = g.node(p).name;
      scope.vars.set(name, params[i] || OTHER);
    });
    const block = g.child(fn.id, 'block');
    if (block) statement(block, scope);
  }

  function assign(leftId, value, scope) {
    const left = g.node(leftId);
    if (left.type === 'Identifier') {
      // Static analysis sees every branch, so keep whichever value holds data.
      const s = (function () {
        for (let x = scope; x; x = x.parent) if (x.vars.has(left.name)) return x;
        return scope;
      })();
      if (!holdsData(s.vars.get(left.name)) || holdsData(value)) s.vars.set(left.name, value);
      return;
    }
    if (left.type === 'MemberExpression') {
      const obj = evaluate(g.child(leftId, 'object'), scope);
      const prop = memberName(leftId);
      if (obj.kind === 'obj') obj.props.set(prop, value);
      else if (obj.kind === 'elem') writes.add(obj.coll + '.' + prop);
    }
  }

  function statement(id, scope) {
    const n = g.node(id);
    switch (n.type) {
      case 'VariableDeclarator': {
        const init = g.child(id, 'init');
        let value = evaluate(init, scope);
        if (g.collectionDecls.has(id) && value.kind !== 'coll') {
          value = { kind: 'coll', coll: g.collectionDecls.get(id) };
        }
        scope.vars.set(n.name, value);
        break;
      }
      case 'ExpressionStatement': {
        const expr = g.child(id, 'expression');
        if (g.node(expr).type === 'AssignmentExpression') {
          assign(g.child(expr, 'left'), evaluate(g.child(expr, 'right'), scope), scope);
        } else {
          evaluate(expr, scope);
        }
        break;
      }
      case 'IfStatement':
        evaluate(g.child(id, 'test'), scope);
        // Static analysis: both branches.
        for (const branch of ['then', 'else']) {
          const b = g.child(id, branch);
          if (b) statement(b, scope);
        }
        break;
      case 'BlockStatement':
        for (const e of g.kids(id)) if (e.type === 'stmt') statement(e.to, scope);
        break;
      case 'ReturnStatement':
        evaluate(g.child(id, 'argument'), scope);
        break;
      default:
        break;
    }
  }

  // JSON is a global; give it its own kind so JSON.parse/stringify pass data through.
  top.vars.set('JSON', { kind: 'json' });

  runFunction({ id: fnId, scope: top }, [{ kind: 'req', tainted: true }, { kind: 'res' }]);
  return { reads, writes, flags };
}

module.exports = { findFlows };
