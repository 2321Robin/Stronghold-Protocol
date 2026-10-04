// 观战整备区的客户端(游玩记录 #2 item 1):ScoutedBench 渲染 m.field(prep:true).bench 的只读缩略图,
// 点击打开该棋子的详情卡(chess 带装备 id,同盟约弹窗同构行的路径);game screen 只在自己观战别人
// 整备期棋盘时渲染它。服务器侧:test/match/prep-bench.test.js。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScoutedBench } from '../../public/js/ui/scoutedBench.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return textOf(v.props?.children);
};

describe('ScoutedBench', () => {
  const bench = [
    { uid: 1, kind: 'chess', id: 'chess_char_1_01_a', tier: 5, golden: false },
    { uid: 2, kind: 'chess', id: 'chess_char_1_02_a', tier: 5, golden: true, items: ['chess_item_1_01_e_a'] },
    { uid: 3, kind: 'item', id: 'chess_item_6_09_e_a', tier: 6 },
  ];

  test('renders one read-only thumbnail per held piece and names the owner', () => {
    const picks = [];
    const v = ScoutedBench({ bench, name: '博士二', onPick: (p) => picks.push(p) });
    const ones = [...walk(v)].filter((x) => hasClass(x, 'sbench__one'));
    assert.equal(ones.length, 3);
    const label = [...walk(v)].find((x) => hasClass(x, 'sbench__label'));
    assert.match(textOf(label), /博士二 的整备区/);
    assert.match(textOf(label), /3/, 'the count of held pieces');
    ones[1].props.onClick();
    assert.deepEqual(picks, [bench[1]], 'the tap hands the piece on (game screen builds the detail target)');
  });

  test('empty or missing bench renders nothing', () => {
    assert.equal(ScoutedBench({ bench: [] }), null);
    assert.equal(ScoutedBench({ bench: null }), null);
  });

  test('the game screen shows it only while scouting a prep board and opens the detail on tap (source)', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /field\?\.prep && watchingOther && Array\.isArray\(field\.bench\)/);
    assert.match(game, /\{ kind: 'chess', id: p\.id, items: Array\.isArray\(p\.items\) \? p\.items : null \}/);
    assert.match(read('public/css/screens/game.css'), /\.sbench \{/);
  });
});
