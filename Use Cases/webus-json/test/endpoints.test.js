'use strict';

// Phase 2 "done when": all four endpoints work with no bug flags set.
// Every case runs against both app.js and app-single-file.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webus-json-'));
process.env.WEBUS_DB = path.join(dir, 'db.json');
delete process.env.WEBUS_BUGS;
const store = require('../store');

const onDisk = () => JSON.parse(fs.readFileSync(store.DATA_FILE, 'utf8'));
const keys = (o) => Object.keys(o).sort();

const maria = {
  name: 'Maria Silva', e_mail: 'maria.silva@example.com',
  credit_card: '4000056655665556', destination: 'Porto', schedule: '2026-12-01',
};

after(() => fs.rmSync(dir, { recursive: true, force: true }));

for (const file of ['app.js', 'app-single-file.js']) {
  describe(file, () => {
    const app = require(path.join('..', file));
    let server;
    let base;

    before(() => new Promise((resolve) => {
      server = app.listen(0, () => {
        base = 'http://127.0.0.1:' + server.address().port;
        resolve();
      });
    }));
    after(() => new Promise((resolve) => server.close(resolve)));
    beforeEach(() => store.reset());

    async function call(method, url, body) {
      const options = { method };
      if (body !== undefined) {
        options.headers = { 'content-type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      const res = await fetch(base + url, options);
      return { status: res.status, body: await res.json() };
    }

    describe('GET /tickets/schedules', () => {
      it('lists every trip with only destination and date', async () => {
        const res = await call('GET', '/tickets/schedules');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, store.db.schedules.length);
        res.body.forEach((s) => assert.deepStrictEqual(keys(s), ['date', 'destination']));
        assert.deepStrictEqual(res.body[0], { destination: 'Porto', date: '2026-12-01' });
      });
    });

    describe('POST /tickets/buy_ticket', () => {
      it('adds the ticket and saves it', async () => {
        const before = store.db.tickets.length;
        const res = await call('POST', '/tickets/buy_ticket', maria);
        assert.strictEqual(res.status, 200);

        const t = res.body.createdTicket;
        assert.deepStrictEqual(keys(res.body), ['createdTicket']);
        assert.strictEqual(typeof t._id, 'string');
        assert.deepStrictEqual(
          { name: t.name, e_mail: t.e_mail, destination: t.destination, date: t.date, credit_card: t.credit_card },
          { name: maria.name, e_mail: maria.e_mail, destination: 'Porto', date: '2026-12-01', credit_card: maria.credit_card });

        assert.strictEqual(store.db.tickets.length, before + 1);
        assert.deepStrictEqual(onDisk().tickets[before], t);
      });

      it('does not touch schedules (no travelers leak)', async () => {
        await call('POST', '/tickets/buy_ticket', maria);
        store.db.schedules.forEach((s) => assert.deepStrictEqual(s.travelers, []));
        const res = await call('GET', '/tickets/schedules');
        res.body.forEach((s) => assert.ok(!('travelers' in s)));
      });

      it('trims name, e_mail and destination like the Mongoose schema', async () => {
        const res = await call('POST', '/tickets/buy_ticket',
          Object.assign({}, maria, { name: '  Maria Silva ', e_mail: ' maria.silva@example.com', destination: 'Porto  ' }));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.createdTicket.name, 'Maria Silva');
        assert.strictEqual(res.body.createdTicket.e_mail, 'maria.silva@example.com');
        assert.strictEqual(res.body.createdTicket.destination, 'Porto');
      });

      it('stores a numeric card number as a string', async () => {
        const res = await call('POST', '/tickets/buy_ticket', Object.assign({}, maria, { credit_card: 4111111111111111 }));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.createdTicket.credit_card, '4111111111111111');
      });

      for (const field of ['name', 'e_mail', 'credit_card', 'destination', 'schedule']) {
        it('rejects a missing ' + field, async () => {
          const body = Object.assign({}, maria);
          delete body[field];
          const before = store.db.tickets.length;
          const res = await call('POST', '/tickets/buy_ticket', body);
          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.body, 'Missing information');
          assert.strictEqual(store.db.tickets.length, before);
        });
      }

      const bad = {
        'an impossible date': { schedule: '2026-02-30' },
        'a non-ISO date': { schedule: 'December 1, 2026' },
        'a non-numeric card': { credit_card: '4111-1111-1111-1111' },
        'an object as name': { name: { first: 'Maria' } },
      };
      for (const label of Object.keys(bad)) {
        it('rejects ' + label, async () => {
          const before = store.db.tickets.length;
          const res = await call('POST', '/tickets/buy_ticket', Object.assign({}, maria, bad[label]));
          assert.strictEqual(res.status, 400);
          assert.strictEqual(res.body, 'Error buying ticket.');
          assert.strictEqual(store.db.tickets.length, before);
        });
      }
    });

    describe('GET /tickets/purchase_history', () => {
      it("returns only the named person's tickets, as name, destination and date", async () => {
        const res = await call('GET', '/tickets/purchase_history?name=' + encodeURIComponent('Ana Pereira'));
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, [
          { name: 'Ana Pereira', destination: 'Faro', date: '2025-07-14' },
          { name: 'Ana Pereira', destination: 'Porto', date: '2026-12-01' },
        ]);
      });

      it('includes a ticket bought just before', async () => {
        await call('POST', '/tickets/buy_ticket', maria);
        const res = await call('GET', '/tickets/purchase_history?name=' + encodeURIComponent(maria.name));
        assert.deepStrictEqual(res.body, [{ name: maria.name, destination: 'Porto', date: '2026-12-01' }]);
      });

      it('treats the name as plain text, so injection matches nothing', async () => {
        const res = await call('GET', '/tickets/purchase_history?name=' + encodeURIComponent("' || 'a' === 'a"));
        assert.deepStrictEqual(res.body, []);
      });

      it('returns an empty list without a name', async () => {
        const res = await call('GET', '/tickets/purchase_history');
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, []);
      });
    });

    describe('POST /newsletter/subscribe', () => {
      it('adds the e-mail and saves it, without reading tickets', async () => {
        const before = store.db.newsletter.length;
        const res = await call('POST', '/newsletter/subscribe', { e_mail: ' joao.costa@example.com ' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(keys(res.body), ['subscribedEmail']); // no frequentTraveler
        assert.strictEqual(res.body.subscribedEmail.e_mail, 'joao.costa@example.com');
        assert.strictEqual(store.db.newsletter.length, before + 1);
        assert.deepStrictEqual(onDisk().newsletter[before], res.body.subscribedEmail);
      });

      it('accepts the home page form post', async () => {
        const res = await fetch(base + '/newsletter/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'e_mail=' + encodeURIComponent('maria.silva@example.com'),
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual((await res.json()).subscribedEmail.e_mail, 'maria.silva@example.com');
      });

      it('rejects a missing e-mail', async () => {
        const res = await call('POST', '/newsletter/subscribe', {});
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body, 'Missing information');
      });
    });

    if (file === 'app.js') {
      it('GET / serves the home page', async () => {
        const res = await fetch(base + '/');
        assert.strictEqual(res.status, 200);
        assert.match(await res.text(), /Webus Ticket Management/);
      });
    }
  });
}
