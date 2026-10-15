// The cumulative strategies' progress reaches the client (user playtest #16 "累计型策略加进度显示"): m.private
// carries the content counters the UI shows — PlayerState.progressCounters passes every `band:*` counter through
// (the per-round ones' `:<key>:r` round stamp included; ui/bandProgress.js reads it to tell this round's count from
// the last round's) and every per-item-copy counter of the 商业包装方案 (`pack:<piece uid>`, builtinMeta onSold) —
// and nothing else (choices:refSeq and friends stay server-side). The texts themselves are the client's
// (test/ui/band-progress.test.js); here the counters and their live updates through the real meta dispatches.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';

const kazimierz = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && Array.isArray(c.bonds) && c.bonds.includes('kazimierzShip')).chessId;

describe('m.private.counters — the progress counters on the view', () => {
  test('progressCounters: band:/pack: counters pass (round stamps included), other content counters stay out', () => {
    const h = makeMatch({ mode: 'solo', humans: 1 }).start();
    const ps = h.ps('p_0');
    ps.counters['band:kirara:acc'] = 5;
    ps.counters['band:chiave'] = 1;
    ps.counters['band:chiave:r'] = 3;
    ps.counters['pack:4242'] = 2;
    ps.counters['choices:refSeq'] = 7;
    const c = ps.privateView().counters;
    assert.deepEqual(c, { 'band:kirara:acc': 5, 'band:chiave': 1, 'band:chiave:r': 3, 'pack:4242': 2 });
  });

  test('empty by default (a fresh player has no counters) and tolerant to junk entries', () => {
    const h = makeMatch({ mode: 'solo', humans: 1 }).start();
    const ps = h.ps('p_0');
    assert.deepEqual(ps.privateView().counters, {});
    ps.counters['band:weird'] = 'not-a-number';
    ps.counters['pack:x'] = NaN;
    assert.deepEqual(ps.privateView().counters, {});
  });

  test('kirara 通关奖励 counts spent funds through the real onSpend dispatch (the remainder stays visible)', () => {
    const h = makeMatch({ mode: 'solo', humans: 1 }).start();
    const m = h.m;
    const ps = h.ps('p_0');
    ps.bandId = 'band_kirara';
    m.dispatch(ps, 'onSpend', { amount: 25, reason: 'buy' });
    assert.equal(ps.counters['band:kirara:acc'], 5, '25 spent − one 20 grant = 5 toward the next');
    assert.equal(ps.privateView().counters['band:kirara:acc'], 5);
  });

  test('paganini 定制铳械 accumulates to the goal and flags done; mlynar 业务指标 counts per round with its stamp', () => {
    const h = makeMatch({ mode: 'solo', humans: 1 }).start();
    const m = h.m;
    const ps = h.ps('p_0');
    ps.bandId = 'band_paganini';
    m.dispatch(ps, 'onSpend', { amount: 30, reason: 'buy' });
    assert.equal(ps.privateView().counters['band:paganini:spent'], 30);
    assert.equal(ps.privateView().counters['band:paganini:done'], undefined);
    m.dispatch(ps, 'onSpend', { amount: 25, reason: 'buy' });
    assert.equal(ps.counters['band:paganini:done'], 1);

    h.toPrep(1); // a real round number: the round stamp defaults to 0, round 0 would never write it
    ps.bandId = 'band_mlynar'; // after toPrep — the draft on the way would overwrite it
    m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id: kazimierz } });
    const c = ps.privateView().counters;
    assert.equal(c['band:mlynar'], 1, 'the rounds first 卡西米尔 buy');
    assert.equal(c['band:mlynar:r'], m.round, 'the stamp says which round the count belongs to');
  });
});
