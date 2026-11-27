'use strict';

// Phase 3 "done when": each WEBUS_BUGS flag switches on one of the original's
// bugs, and only that one. Every case runs against both app.js and app-single-file.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webus-json-'));
process.env.WEBUS_DB = path.join(dir, 'db.json');
const store = require('../store');

const keys = (o) => Object.keys(o).sort();
const onDisk = () => JSON.parse(fs.readFileSync(store.DATA_FILE, 'utf8'));
const setBugs = (flags) => { process.env.WEBUS_BUGS = flags; };

const maria = {
  name: 'Maria Silva', e_mail: 'maria.silva@example.com',
  credit_card: '4000056655665556', destination: 'Porto', schedule: '2026-12-01',
};

after(() => {
  delete process.env.WEBUS_BUGS;
  fs.rmSync(dir, { recursive: true, force: true });
});

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
    const history = (name) => call('GET', '/tickets/purchase_history?name=' + encodeURIComponent(name));

    describe('promo (Ex 1)', () => {
      beforeEach(() => setBugs('promo'));

      it('flags a subscriber with 10+ tickets as a frequent traveler', async () => {
        const res = await call('POST', '/newsletter/subscribe', { e_mail: 'joao.costa@example.com' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(keys(res.body), ['frequentTraveler', 'subscribedEmail']);
        assert.strictEqual(res.body.frequentTraveler, true);
      });

      it("counts pre-2020 tickets, like the original's new Date(2020)", async () => {
        // Rui: 11 tickets, only 8 from 2020 on.
        const res = await call('POST', '/newsletter/subscribe', { e_mail: 'rui.santos@example.com' });
        assert.strictEqual(res.body.frequentTraveler, true);
      });

      it('answers false for a subscriber with few or no tickets', async () => {
        assert.strictEqual((await call('POST', '/newsletter/subscribe', { e_mail: 'ana.pereira@example.com' })).body.frequentTraveler, false);
        assert.strictEqual((await call('POST', '/newsletter/subscribe', { e_mail: 'nobody@example.com' })).body.frequentTraveler, false);
      });

      it('still saves the subscription', async () => {
        const before = store.db.newsletter.length;
        const res = await call('POST', '/newsletter/subscribe', { e_mail: 'joao.costa@example.com' });
        assert.deepStrictEqual(onDisk().newsletter[before], res.body.subscribedEmail);
      });

      it('leaves the other endpoints clean', async () => {
        const res = await call('POST', '/tickets/buy_ticket', maria);
        assert.deepStrictEqual(keys(res.body), ['createdTicket']);
        assert.deepStrictEqual(await history("' || 'a' === 'a").then((r) => r.body), []);
      });
    });

    describe('travelers (Ex 2)', () => {
      beforeEach(() => setBugs('travelers'));

      it("adds the buyer's name to the matching schedule and saves it", async () => {
        const res = await call('POST', '/tickets/buy_ticket', maria);
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(keys(res.body), ['createdTicket', 'updatedSchedule']);
        // Like findOneAndUpdate without {new: true}: the schedule before the push.
        assert.deepStrictEqual(res.body.updatedSchedule.travelers, []);

        const trip = store.db.schedules.find((s) => s.destination === 'Porto' && s.date === '2026-12-01');
        assert.deepStrictEqual(trip.travelers, ['Maria Silva']);
        assert.deepStrictEqual(onDisk().schedules.find((s) => s._id === trip._id).travelers, ['Maria Silva']);
      });

      it('GET /tickets/schedules returns the travelers', async () => {
        await call('POST', '/tickets/buy_ticket', maria);
        const res = await call('GET', '/tickets/schedules');
        assert.strictEqual(res.status, 200);
        const trip = res.body.find((s) => s.destination === 'Porto' && s.date === '2026-12-01');
        assert.deepStrictEqual(trip.travelers, ['Maria Silva']);
      });

      it('still saves the ticket when no schedule matches', async () => {
        const before = store.db.tickets.length;
        const res = await call('POST', '/tickets/buy_ticket', Object.assign({}, maria, { schedule: '2026-11-30' }));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.updatedSchedule, null);
        assert.strictEqual(onDisk().tickets.length, before + 1);
        store.db.schedules.forEach((s) => assert.deepStrictEqual(s.travelers, []));
      });

      it('leaves the other endpoints clean', async () => {
        const res = await call('POST', '/newsletter/subscribe', { e_mail: 'joao.costa@example.com' });
        assert.deepStrictEqual(keys(res.body), ['subscribedEmail']);
      });
    });

    describe('inject (Ex 3)', () => {
      beforeEach(() => setBugs('inject'));

      it('still answers a normal name', async () => {
        const res = await history('Ana Pereira');
        assert.deepStrictEqual(res.body, [
          { name: 'Ana Pereira', destination: 'Faro', date: '2025-07-14' },
          { name: 'Ana Pereira', destination: 'Porto', date: '2026-12-01' },
        ]);
      });

      it('lets an injected condition return every ticket', async () => {
        const res = await history("' || 'a' === 'a");
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, store.db.tickets.length);
        res.body.forEach((t) => assert.deepStrictEqual(keys(t), ['date', 'destination', 'name']));
      });

      it('leaks credit_card one guess at a time', async () => {
        const probe = (digit) => history("' || (this.name === 'Ana Pereira' && this.credit_card.charAt(0) === '" + digit + "') || '");
        assert.strictEqual((await probe('3')).body.length, 2); // Ana's card starts with 3
        assert.strictEqual((await probe('4')).body.length, 0);
      });

      it('answers 400 when the injected code does not compile', async () => {
        const res = await history("'(");
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body, 'Error fetching ticket history.');
      });

      it('leaves the other endpoints clean', async () => {
        const res = await call('GET', '/tickets/schedules');
        res.body.forEach((s) => assert.deepStrictEqual(keys(s), ['date', 'destination']));
      });
    });

    describe('all three', () => {
      beforeEach(() => setBugs(' promo, travelers ,inject'));

      it('switches on every bug together (spaces in the list are fine)', async () => {
        assert.strictEqual((await call('POST', '/newsletter/subscribe', { e_mail: 'joao.costa@example.com' })).body.frequentTraveler, true);
        await call('POST', '/tickets/buy_ticket', maria);
        const schedules = (await call('GET', '/tickets/schedules')).body;
        assert.ok(schedules.some((s) => s.travelers.indexOf('Maria Silva') !== -1));
        assert.strictEqual((await history("' || 'a' === 'a")).body.length, store.db.tickets.length);
      });
    });

    describe('an unknown flag', () => {
      beforeEach(() => setBugs('promotion'));

      it('switches nothing on', async () => {
        const res = await call('POST', '/newsletter/subscribe', { e_mail: 'joao.costa@example.com' });
        assert.deepStrictEqual(keys(res.body), ['subscribedEmail']);
      });
    });
  });
}
