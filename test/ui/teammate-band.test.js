// 队友的策略(游玩记录 #2 item 2:「观战队友时看不到队友的策略详情」)。服务器一直下发
// m.public.players[].bandId,但客户端唯一的展示是队伍栏头像的底图;本局信息抽屉只读自己的
// priv.bandId(ui/enemyDrawer.js InfoTab)。现在点击队友单位打开的详情卡在末尾显示其主人的策略
// (名称 + 效果,gameLogic.ownerBandId → resolveDetail `bandId` → ChessDetail 的 策略 section)。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const chess = JSON.parse(read('data/chess.json'));
const WEARER = 'chess_char_1_01_a'; // 隐现

import { ownerBandId } from '../../public/js/ui/gameLogic.js';

describe('ownerBandId — the picked 策略 of a player', () => {
  const pub = { players: [
    { playerId: 'p1', name: '博士一', bandId: 'band_bldsk' },
    { playerId: 'p2', name: '博士二' }, // not picked yet (draft running)
  ] };
  test('the bandId of the owner, null for anyone without one or an unknown id', () => {
    assert.equal(ownerBandId(pub, 'p1'), 'band_bldsk');
    assert.equal(ownerBandId(pub, 'p2'), null);
    assert.equal(ownerBandId(pub, 'pX'), null);
    assert.equal(ownerBandId(null, 'p1'), null);
    assert.equal(ownerBandId({ players: [] }, 'p1'), null);
  });
});

// ---- the card: resolveDetail hands the band on, ChessDetail renders it ---------------------------------------------

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
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'bands');
const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return textOf(v.props?.children);
};

test('resolveDetail passes the tap\'s bandId on; a plain unit target carries none', () => {
  const d = resolveDetail({ kind: 'unit', unit: { id: 1, kind: 'op', side: 'ally', ownerId: 'p2', defId: WEARER }, bandId: 'band_bldsk' }, new Map());
  assert.equal(d.bandId, 'band_bldsk');
  assert.equal('bandId' in resolveDetail({ kind: 'unit', unit: { id: 2, kind: 'op', side: 'ally', ownerId: 'p2', defId: WEARER } }, new Map()), false);
});

test("a teammate's card shows the owner's 策略: name, effect and its text; own pieces show none", () => {
  const mine = [{ bondId: 'victoriaShip', count: 3, active: true, tier: 1, layers: 0, thresholds: [3, 6] }];
  const blocks = ChessDetail({ chess: chess[WEARER], piece: null, editable: false, bonds: mine, loadout: null, ownerBandId: 'band_bldsk' });
  const band = blocks.find((b) => b?.key === 'band');
  assert.ok(band, 'the 策略 section renders');
  const text = textOf(band);
  assert.match(text, /华法琳/, 'the band\'s name');
  assert.match(text, /重点监护/, 'its effectName');
  const desc = [...walk(band)].find((x) => typeof x.props?.class === 'string' && x.props.class.split(/\s+/).includes('dband__desc'));
  assert.ok(desc, 'the effect text node renders');
  assert.match(String(desc.props.text), /开始作战时/, 'its effect text');
  const bare = ChessDetail({ chess: chess[WEARER], piece: null, editable: false, bonds: mine, loadout: null });
  assert.equal(bare.find((b) => b?.key === 'band'), undefined, 'no 策略 section without an owner band (own pieces, plain records)');
});

test('the game screen reads the band at the tap and the panel forwards it (hooks components: source)', () => {
  assert.match(read('public/js/screens/game.js'), /bandId: ownerBandId\(pub, e\.unit\?\.ownerId\)/);
  const panel = read('public/js/ui/detailPanel.js');
  assert.match(panel, /ownerBandId=\$\{detail\.bandId \|\| null\}/);
  assert.match(panel, /const band = ownerBandId \? data\.lookup\('bands', ownerBandId\) : null/);
});
