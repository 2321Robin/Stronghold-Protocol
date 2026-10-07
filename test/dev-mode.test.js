// test/dev-mode.test.js — the LOCAL dev tool (playtest #24, never for upstream): the room option
// room.setExtras devMode and the in-match g.dev quick switches (server/match/match/dev.js).
//   * protocol: the g.dev shape validates; room.setExtras carries both options independently (absent = unchanged);
//   * match (harness): g.dev funds sets the sender's funds in PREP (default and custom value), the push reaches the
//     player's m.private; off by default, outside PREP, eliminated, unknown actions — all refused;
//   * lobby (WebSocket, stub match): the host toggles each extra independently, a guest cannot, the ready reset
//     covers a devMode change too, and the option reaches the match constructor.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { validateC2S } from '../shared/protocol.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch } from './match/harness.js';

const quietLog = () => ({ log: { info() {}, warn() {}, debug() {}, error() {} } });

describe('dev mode: protocol shape', () => {
  test('g.dev takes action + optional v', () => {
    assert.equal(validateC2S({ t: 'g.dev', action: 'funds', v: 999 }), null);
    assert.equal(validateC2S({ t: 'g.dev', action: 'funds' }), null, 'v is optional (the server default applies)');
    assert.ok(validateC2S({ t: 'g.dev', action: {} }), 'a non-string action is refused');
    assert.ok(validateC2S({ t: 'g.dev', action: 'funds', v: -1 }), 'a negative v is refused');
    assert.ok(validateC2S({ t: 'g.dev', action: 'funds', v: 2 ** 30 }), 'v above the 1e6 cap is refused');
    assert.ok(validateC2S({ t: 'g.dev' }), 'action is required');
  });
  test('room.setExtras: each option optional, unknown fields still rejected by the server handler', () => {
    assert.equal(validateC2S({ t: 'room.setExtras', devMode: true }), null);
    assert.equal(validateC2S({ t: 'room.setExtras', earthspirit: true }), null, 'the pre-devMode client shape stays valid');
    assert.equal(validateC2S({ t: 'room.setExtras', earthspirit: false, devMode: true }), null);
    assert.equal(validateC2S({ t: 'room.setExtras' }), null, 'both absent = no-op, still a valid message');
    assert.ok(validateC2S({ t: 'room.setExtras', devMode: 'yes' }));
  });
});

describe('dev mode: match (harness)', () => {
  test('devMode on: g.dev funds sets the sender\u2019s funds (custom value, default value) and reaches m.private', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, extras: { devMode: true } });
    h.start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.funds = 3;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds', v: 500 }), { ok: true });
    assert.equal(ps.funds, 500, 'v sets the absolute value');
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds' }), { ok: true });
    assert.equal(ps.funds, 999, 'without v the default 999 applies');
    h.flushAll();
    assert.equal(h.lastTo('p_0', 'm.private').funds, 999, 'the push carries the new funds');
    assert.ok(h.invariants());
  });
  test('the option reaches m.public.extras', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, extras: { devMode: true } });
    h.start();
    h.flushAll();
    assert.equal(h.lastBc('m.public').extras?.devMode, true, 'clients can show the panel from m.public');
  });
  test('devMode off: every g.dev fails and funds stay untouched', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1 });
    h.start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    ps.funds = 3;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds', v: 999 }), { error: 'BAD_MSG', detail: 'dev mode is off' });
    assert.equal(ps.funds, 3, 'no funds moved');
  });
  test('outside PREP, eliminated, and unknown actions are refused', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, extras: { devMode: true } });
    h.start();
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds', v: 999 }), { error: 'WRONG_PHASE' }, 'INFO_CHECK refuses');
    h.toPrep(1);
    const ps = h.ps('p_0');
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'teleport', v: 1 }), { error: 'BAD_MSG', detail: 'unknown dev action teleport' }, 'unknown action');
    ps.alive = false;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds' }), { error: 'ELIMINATED' });
  });
});

describe('dev mode: lobby over WebSocket (stub match)', () => {
  let srv;
  let pool;
  const stubs = [];
  class RecordingStub extends StubMatch {
    constructor(opts) { super(opts); this.opts = opts; stubs.push(this); }
  }
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: quietLog().log, MatchClass: RecordingStub });
    pool = {
      open: new Set(),
      async player(name) {
        const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
        this.open.add(c);
        const w = await c.hello(name);
        c.id = w.playerId;
        return c;
      },
      async closeAll() { await Promise.all([...this.open].map((c) => c.terminate().catch(() => {}))); this.open.clear(); },
    };
  });
  afterEach(async () => { stubs.length = 0; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
  const errCode = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); return r.code; };

  test('the room state carries both extras (default off); the host toggles them independently', async () => {
    const host = await pool.player('DevHost');
    await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.deepEqual(st.extras, { earthspirit: false, devMode: false });
    await ok(host, { t: 'room.setExtras', devMode: true });
    const on = await host.waitFor('room.state', (s) => s.extras?.devMode === true);
    assert.equal(on.extras.earthspirit, false, 'the other extra is untouched');
    await ok(host, { t: 'room.setExtras', earthspirit: true, devMode: true });
    const both = await host.waitFor('room.state', (s) => s.extras?.earthspirit === true);
    assert.equal(both.extras.devMode, true);
    await ok(host, { t: 'room.setExtras', earthspirit: false });
    const back = await host.waitFor('room.state', (s) => s.extras?.earthspirit === false);
    assert.equal(back.extras.devMode, true, 'a patch without devMode leaves devMode on');
  });

  test('a guest cannot toggle; the ready reset covers a devMode change; the option reaches the match', async () => {
    const host = await pool.player('DevHost2');
    const guest = await pool.player('DevGuest');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await ok(guest, { t: 'room.join', code: (await host.waitFor('room.state', (s) => s.hostId === host.id)).code });
    assert.equal(await errCode(guest, { t: 'room.setExtras', devMode: true }), 'NOT_HOST');
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.setExtras', devMode: true });
    const st = await host.waitFor('room.state', (s) => s.extras?.devMode === true);
    const guestSeat = st.seats.find((s) => s.playerId === guest.id);
    assert.equal(guestSeat.ready, false, 'a devMode change un-readies the others (like every extra)');
    await ok(guest, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.ready', ready: true });
    await ok(host, { t: 'room.start' });
    const stub = stubs.at(-1);
    assert.deepEqual(stub.opts.extras, { earthspirit: false, devMode: true }, 'the match gets the devMode option');
  });
});
