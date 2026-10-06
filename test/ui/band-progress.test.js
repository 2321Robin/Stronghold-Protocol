// The strategy / item progress texts (user playtest #16): ui/bandProgress.js is the one place turning m.private.counters
// into display lines — the four cumulative strategies (潘格尼尼 累计花费 / 贾维 refreshes + per-round grants / 绮良
// 距下次 / 玛恩纳 this round's buys vs the last round's arrived funds — the lazy per-round counter's `:r` round stamp
// tells them apart) and the 商业包装方案's per-copy sold counter (pack:<uid>). The counters reaching m.private at all is
// test/match/band-progress.test.js; here the texts, and the wiring of the three surfaces (source assertions).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
await data.loadAll('bands', 'items');
const { bandProgress, packProgress } = await import('../../public/js/ui/bandProgress.js');

describe('bandProgress — the four cumulative strategies', () => {
  test('paganini 定制铳械: 累计花费 X/55, clamped, 已完成 once done (badge gone)', () => {
    assert.deepEqual(bandProgress('band_paganini', { 'band:paganini:spent': 30 }), { lines: ['累计花费 30/55'], badge: 30, tip: '累计花费 30/55' });
    assert.deepEqual(bandProgress('band_paganini', { 'band:paganini:spent': 70 }), { lines: ['累计花费 55/55'], badge: 55, tip: '累计花费 55/55' });
    assert.deepEqual(bandProgress('band_paganini', { 'band:paganini:spent': 55, 'band:paganini:done': 1 }),
      { lines: ['累计花费 55/55 · 已完成'], badge: null, tip: '已完成' });
  });

  test('kirara 通关奖励: 距下次 X/20 from the remainder the server leaves in the counter', () => {
    assert.deepEqual(bandProgress('band_kirara', { 'band:kirara:acc': 5 }), { lines: ['距下次 5/20'], badge: 5, tip: '距下次 5/20' });
    assert.deepEqual(bandProgress('band_kirara', {}), { lines: ['距下次 0/20'], badge: 0, tip: '距下次 0/20' });
  });

  test('chiave 团伙行动: 距下次 X/6 + 累计, 本回合已得 Y/2 — last round\u2019s grants do not show as this round\u2019s', () => {
    // mid-round: the stamp matches, the round counter is fresh
    assert.deepEqual(
      bandProgress('band_chiave', { 'band:chiave:refreshes': 13, 'band:chiave': 1, 'band:chiave:r': 3 }, 3),
      { lines: ['距下次 1/6(累计刷新 13)', '本回合已得 1/2'], badge: 1, tip: '距下次 1/6 · 本回合已得 1/2' },
    );
    // new round, no refresh yet: the counter still holds round 2\u2019s grants — shown as 0/2 (a refresh resets it lazily)
    assert.deepEqual(
      bandProgress('band_chiave', { 'band:chiave:refreshes': 12, 'band:chiave': 2, 'band:chiave:r': 2 }, 3),
      { lines: ['距下次 0/6(累计刷新 12)', '本回合已得 0/2'], badge: 0, tip: '距下次 0/6 · 本回合已得 0/2' },
    );
    // without a round (a caller that has none) the stale count never masquerades as this round\u2019s
    assert.equal(bandProgress('band_chiave', { 'band:chiave:refreshes': 12, 'band:chiave': 2, 'band:chiave:r': 2 }).lines[1], '本回合已得 0/2');
  });

  test('mlynar 业务指标: this round buys into next round\u2019s funds; before the first buy it says the arrived +N', () => {
    // mid-round (the stamp is this round): X bought, next round +X
    assert.deepEqual(
      bandProgress('band_mlynar', { 'band:mlynar': 2, 'band:mlynar:r': 5 }, 5),
      { lines: ['本回合已购 2 名 · 下回合 +2'], badge: 2, tip: '本回合已购 2/3' },
    );
    // prep of the next round, no 卡西米尔 bought yet: the counter holds round 5\u2019s count — whose funds just arrived
    assert.deepEqual(
      bandProgress('band_mlynar', { 'band:mlynar': 2, 'band:mlynar:r': 5 }, 6),
      { lines: ['上回合已购 2 名 · 本回合 +2 已到账'], badge: null, tip: '本回合 +2 已到账' },
    );
    // two rounds without a buy: 上回合 would be wrong — the stamp round is named
    assert.deepEqual(
      bandProgress('band_mlynar', { 'band:mlynar': 3, 'band:mlynar:r': 5 }, 7).lines[0],
      '第 5 回合已购 3 名 · 本回合 +3 已到账',
    );
    // the counter above its cap (a data change) reads as the cap, never +5
    assert.equal(bandProgress('band_mlynar', { 'band:mlynar': 5, 'band:mlynar:r': 5 }, 5).lines[0], '本回合已购 3 名 · 下回合 +3');
  });

  test('bands without cumulative counters and missing counters show nothing', () => {
    assert.equal(bandProgress('band_bldsk', { 'band:bldsk': 1 }), null, 'bldsk has no progress branch');
    assert.equal(bandProgress('band_kirara', null), null, 'no counters (a scouted board, pre-draft)');
    assert.equal(bandProgress(null, {}), null);
    assert.equal(bandProgress('band_nope', {}), null, 'unknown band');
  });
});

describe('packProgress — the 商业包装方案\u2019s per-copy sold counter', () => {
  const pack = data.lookup('items', 'chess_item_5_07_e_a');
  const packGolden = data.lookup('items', 'chess_item_5_07_e_b');
  const other = data.list('items').find((i) => Array.isArray(i.buffs) && !i.buffs.some((b) => b.key === 'sell_char_count_gain_equip_owner_bond'));

  test('已售 X/N from the copy\u2019s counter, golden N=7 (its own params), clamped', () => {
    assert.deepEqual(packProgress(pack, 4242, { 'pack:4242': 3 }), { text: '已售 3/8', sold: 3, goal: 8 });
    assert.deepEqual(packProgress(packGolden, 4243, { 'pack:4243': 2 }), { text: '已售 2/7', sold: 2, goal: 7 });
    assert.equal(packProgress(pack, 4242, { 'pack:4242': 9 }).text, '已售 8/8');
    assert.deepEqual(packProgress(pack, 4244, {}), { text: '已售 0/8', sold: 0, goal: 8 }, 'another copy stays at 0');
  });

  test('null for anything that is not the player\u2019s own copy', () => {
    assert.equal(packProgress(pack, null, { 'pack:4242': 3 }), null, 'a shop / reward card has no uid');
    assert.equal(packProgress(pack, 4242, null), null, 'a scouted board has no counters');
    assert.equal(packProgress(other, 4242, { 'pack:4242': 3 }), null, 'an item without the sold-counter buff');
    assert.equal(packProgress(null, 4242, {}), null);
  });
});

describe('the three surfaces are wired (source assertions)', () => {
  const src = (p) => read(p);

  test('m.private carries the counters (PlayerState.privateView → progressCounters)', () => {
    // 0.2.0 split PlayerState into method modules: the method lives in player/views.js, the constructor field stays put
    const ps = src('server/match/PlayerState.js') + src('server/match/player/views.js');
    assert.match(ps, /progressCounters\(\) \{[\s\S]*?startsWith\('band:'\) \|\| k\.startsWith\('pack:'\)/s);
    assert.match(ps, /counters: this\.progressCounters\(\)/);
  });

  test('本局信息 shows the progress lines under one\u2019s own strategy; a scouted band does not', () => {
    const ed = src('public/js/ui/enemyDrawer.js');
    assert.match(ed, /import \{ bandProgress \} from '\.\/bandProgress\.js'/);
    assert.match(ed, /bandProgress\(band\.bandId, priv\?\.counters/);
    assert.match(ed, /iband__progress/);
    assert.match(ed, /band && !bandOwner \? bandProgress/);
  });

  test('the effects strip decorates the band entry from one\u2019s own counters', () => {
    const el = src('public/js/ui/effectsList.js');
    assert.match(el, /bandProgress/);
    const g = src('public/js/screens/game.js');
    assert.match(g, /<\$\{EffectsList\}[^>]*counters=/s);
    assert.match(g, /counters=\$\{detailCounters\}/, 'DetailPanel gets the player\u2019s counters');
  });

  test('the item / wearer cards show 已售 X/N (packProgress with the piece uid)', () => {
    const dp = src('public/js/ui/detailPanel.js');
    assert.match(dp, /import \{ packProgress \} from '\.\/bandProgress\.js'/);
    assert.match(dp, /packProgress\(it, uid, counters\)/, 'ItemRow (the wearer\u2019s card)');
    assert.match(dp, /packProgress\(item, piece && Number\.isInteger\(piece\.uid\)/, 'ItemDetail (the item card)');
  });
});

describe('the three surfaces render (InfoTab / EffectsList / ItemDetail)', () => {
  function* walk(v) {
    if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
    if (!v || typeof v !== 'object') return;
    yield v;
    yield* walk(v.props?.children);
  }
  const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
  const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children])).filter((x) => typeof x === 'string' || typeof x === 'number').join('');
  const first = (v, c) => [...walk(v)].find((n) => hasClass(n, c));

  const COUNTERS = { 'band:chiave:refreshes': 13, 'band:chiave': 1, 'band:chiave:r': 5, 'pack:99': 3 };
  const PRIV = { bandId: 'band_chiave', counters: COUNTERS };
  const PUB = { round: 5 };

  test('InfoTab: the progress block under the strategy, none for a scouted teammate\u2019s band', async () => {
    const { InfoTab } = await import('../../public/js/ui/enemyDrawer.js');
    const prog = first(InfoTab({ pub: PUB, priv: PRIV, onChess: () => {} }), 'iband__progress');
    assert.ok(prog, 'the own band\u2019s progress block');
    assert.equal(textOf(prog), '距下次 1/6(累计刷新 13)本回合已得 1/2');
    const scout = InfoTab({ pub: PUB, priv: PRIV, onChess: () => {}, bandId: 'band_kirara', bandOwner: '队友' });
    assert.equal([...walk(scout)].filter((n) => hasClass(n, 'iband__progress')).length, 0, 'a scouted band has no progress');
  });

  test('EffectsList: the band entry\u2019s badge and tooltip line; nothing without counters', async () => {
    const { EffectsList } = await import('../../public/js/ui/effectsList.js');
    const effects = [{ id: 'aceffect_band_59', name: '团伙行动', desc: 'x', iconKind: 'band', iconId: 'band_chiave' }];
    const badge = first(EffectsList({ effects, bandId: 'band_chiave', counters: COUNTERS, round: 5 }), 'effect__n');
    assert.equal(textOf(badge), '1', '距下次 1/6 as the badge');
    const bare = EffectsList({ effects });
    assert.equal([...walk(bare)].some((n) => hasClass(n, 'effect__n')), false, 'no counters passed → no badge');
  });

  test('ItemDetail: 已售 X/N next to the effect text; nothing without the piece uid', async () => {
    const { ItemDetail } = await import('../../public/js/ui/detailPanel.js');
    const item = data.lookup('items', 'chess_item_5_07_e_a');
    const own = ItemDetail({ item, piece: { uid: 99, kind: 'item', id: item.id }, editable: false, onDestroy: () => {}, counters: COUNTERS });
    assert.equal(textOf(first(own, 'dpack')), '已售 3/8');
    const card = ItemDetail({ item, piece: null, editable: false, onDestroy: () => {}, counters: COUNTERS });
    assert.equal([...walk(card)].some((n) => hasClass(n, 'dpack')), false, 'a shop / reward card has no counter');
  });
});
