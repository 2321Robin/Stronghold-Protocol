// test/earthspirit.test.js — the LOCAL-ONLY room option room.setExtras (「地灵回归」, never for upstream):
//   * protocol: checkLoadout accepts the hidden operator only when the room option's extraChess allows it;
//   * lobby (WebSocket, stub match): the host toggle stores on the room, gates the loadout, reaches the Match's seats;
//   * match (harness): PlayerState.setLoadout applies / ignores it per the match's extras; the shared pool opts in;
//   * client pure helpers: the bond popup's member list, the per-bond banned badge and the 干员调配 roster include
//     the opted-in operator exactly when the extras say so (they were the two gaps the user found in playtesting).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { checkLoadout, extraChessOf } from '../shared/protocol.js';
import { getData } from '../server/data.js';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { makeMatch } from './match/harness.js';
import { bondMembers, bannedPerBond } from '../public/js/ui/gameLogic.js';
import { rosterOf, isLoadoutSlot } from '../public/js/ui/loadoutModel.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });
const ES = 'chess_char_1_11_a'; // 地灵: 1 阶辅助凝滞师, S0 攻击力强化·β型 (default) / S1 流沙化, bonds 奇迹 + 远见
const MIRA = DATA.bonds ? Object.values(DATA.bonds).find((b) => b && b.bondId === 'miraShip') : null;
const SKILL_ALT = { [ES]: { skill: 1 } }; // S1 流沙化: a non-default loadout entry
const ALL = Object.values(DATA.chess);
const quietLog = () => ({ log: { info() {}, warn() {}, debug() {}, error() {} } });

describe('地灵 room option: protocol checkLoadout', () => {
  test('without extras the hidden operator is refused, with extras a real skill choice is accepted', () => {
    assert.equal(checkLoadout(SKILL_ALT, (id) => DATA.chess[id]).error, 'BAD_TARGET');
    const res = checkLoadout(SKILL_ALT, (id) => DATA.chess[id], extraChessOf({ earthspirit: true }));
    assert.equal(res.error, undefined);
    assert.equal(res.loadout[ES].skill, 1);
  });
  test('the golden id stays refused even with extras; a bogus skill stays refused with extras', () => {
    assert.equal(checkLoadout({ [DATA.chess[ES].goldenId]: { skill: 0 } }, (id) => DATA.chess[id], extraChessOf({ earthspirit: true })).error, 'BAD_TARGET');
    assert.equal(checkLoadout({ [ES]: { skill: 7 } }, (id) => DATA.chess[id], extraChessOf({ earthspirit: true })).error, 'BAD_TARGET');
  });
  test('the default-skill entry normalises away (ok, empty loadout) — accepted like any operator', () => {
    const res = checkLoadout({ [ES]: { skill: 0 } }, (id) => DATA.chess[id], extraChessOf({ earthspirit: true }));
    assert.equal(res.error, undefined);
    assert.deepEqual(res.loadout, {});
  });
});

describe('地灵 room option: client pure helpers', () => {
  test('bondMembers shows 地灵 in 奇迹 / 远见 exactly when she is an extra member', () => {
    for (const bondId of ['miraShip', 'visiShip']) {
      const bond = Object.values(DATA.bonds).find((b) => b && b.bondId === bondId);
      const rows = bondMembers(bond, null, [], (id) => DATA.chess[id], () => null, null, [ES]);
      const hers = rows.find((r) => r.id === ES);
      assert.ok(hers, `${bondId}: 地灵 in the member rows with extras`);
      assert.equal(hers.name, '地灵');
      assert.equal(hers.tier, 1);
      assert.equal(rows.some((r) => r.id === ES), true);
      assert.ok(!bondMembers(bond, null, [], (id) => DATA.chess[id]).some((r) => r.id === ES), `${bondId}: absent without extras`);
    }
  });
  test('bondMembers does NOT leak 地灵 into bonds she does not belong to (every other bond)', () => {
    const extras = [ES];
    for (const bond of Object.values(DATA.bonds)) {
      if (!bond || bond.bondId === 'miraShip' || bond.bondId === 'visiShip') continue;
      const rows = bondMembers(bond, null, [], (id) => DATA.chess[id], () => null, null, extras);
      assert.ok(!rows.some((r) => r.id === ES), `${bond.bondId}: 地灵 must not appear`);
    }
  });
  test('bannedPerBond counts 地灵 per bond only with extras (she is in bannedChess when both her bonds are off)', () => {
    assert.equal(bannedPerBond([MIRA], [ES]).get('miraShip'), 0, 'without extras the badge ignores her');
    assert.equal(bannedPerBond([MIRA], [ES], [ES]).get('miraShip'), 1, 'with extras the badge counts her');
  });
  test('rosterOf / isLoadoutSlot include 地灵 only with extras (the 干员调配 roster)', () => {
    assert.ok(!rosterOf(ALL).some((c) => c.chessId === ES), 'absent without extras');
    const withExtras = rosterOf(ALL, [ES]);
    assert.ok(withExtras.some((c) => c.chessId === ES), 'present with extras');
    assert.equal(isLoadoutSlot(DATA.chess[ES], [ES]), true);
    assert.equal(isLoadoutSlot(DATA.chess[ES]), false);
    assert.equal(isLoadoutSlot(DATA.chess[DATA.chess[ES].goldenId], [ES]), false, 'the golden id is never a slot');
  });
});

describe('地灵 room option: match pool + loadout (harness)', () => {
  test('extras on → the shared pool opts her in (12 copies); off → not at all', () => {
    const on = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, extras: { earthspirit: true } });
    assert.equal(on.m.pool.has(ES), true);
    assert.equal(on.m.pool.cap(ES), 12);
    const off = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1 });
    assert.equal(off.m.pool.has(ES), false);
  });
  test('PlayerState.setLoadout applies the 地灵 entry with extras and ignores it without', () => {
    const on = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, extras: { earthspirit: true } });
    assert.equal(on.ps('p_0').setLoadout(SKILL_ALT), true);
    const off = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1 });
    assert.equal(off.ps('p_0').setLoadout(SKILL_ALT), false, 'without extras the entry is refused');
  });
});

describe('地灵 room option: lobby over WebSocket (stub match)', () => {
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

  test('host toggle flows through room.state, gates the loadout and reaches the match seats', async () => {
    const host = await pool.player('Host');
    await errCode(host, { t: 'room.loadout', entries: SKILL_ALT }, 'BAD_TARGET'); // extras off → refused
    await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.equal(st.extras?.earthspirit, false, 'the room state carries the extras (default off)');
    await ok(host, { t: 'room.setExtras', earthspirit: true });
    const on = await host.waitFor('room.state', (s) => s.extras?.earthspirit === true);
    assert.equal(on.extras.earthspirit, true);
    await ok(host, { t: 'room.loadout', entries: SKILL_ALT }); // extras on → accepted
    await ok(host, { t: 'room.start' });
    const stub = stubs.at(-1);
    const seatLoadout = stub.opts.seats[0].loadout[ES];
    assert.equal(seatLoadout.skill, 1, 'the 地灵 loadout (skill 流沙化) reaches the match');
    assert.equal(seatLoadout.module, 'uniequip_002_skgoat', 'pinned to her default module alongside the non-default skill');
    assert.deepEqual(stub.opts.extras, { earthspirit: true, devMode: false }, 'the match gets the extras option');
  });

  test('a guest cannot toggle; toggling back off re-gates the loadout', async () => {
    const host = await pool.player('Host2');
    const guest = await pool.player('Guest2');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await ok(guest, { t: 'room.join', code: (await host.waitFor('room.state', (s) => s.hostId === host.id)).code });
    assert.equal(await errCode(guest, { t: 'room.setExtras', earthspirit: true }), 'NOT_HOST');
    await ok(host, { t: 'room.setExtras', earthspirit: true });
    await ok(host, { t: 'room.setExtras', earthspirit: false });
    const off = await host.waitFor('room.state', (s) => s.extras?.earthspirit === false);
    assert.equal(off.extras.earthspirit, false);
    await errCode(host, { t: 'room.loadout', entries: SKILL_ALT }, 'BAD_TARGET');
  });
});
