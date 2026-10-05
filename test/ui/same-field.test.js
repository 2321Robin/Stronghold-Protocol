// 同战场指示(游玩记录 #5:「一起打最后的boss时,看不到自己和哪个玩家是在一块打的」)。数据一直都在
// (m.public.fields[].players:最终攻势 / 隐秘核心是 finalAssault.js pairPlayers 的座位配对;联防的
// field.players 只列 helpers,漏怪方在 pub.unite.leakers)。第一版:phaseBanner 播报 + 队伍栏「同战场」
// 小 chip——2026-10-06 实测未生效:备战期配对(_planBossWaves 已定)根本没进 m.public,开战后横幅一闪、
// chip 太小没人注意到。现在:Match.js 在 boss 回合备战期把配对发布为 pub.bossPairing,phaseBanner 照旧播报,
// TeamPanel 按官方协同的标法给同战场队友的头像加金框(tooltip「与你在同一战场」),从备战一直亮到战斗结束。
// 语义澄清(玩家实测):金框标的是"驻守所在战场的人"——联防场只标帮手(≤2,漏怪方不在场上;2 漏怪 +
// 2 帮手曾把全队框满),横幅也只有帮手视角说「你与【X】在同一战场」,漏怪方读中性的「联防:X、Y」名单。
// 联防的金框描述的是"这个战场由谁驻守",对任何观看者都成立并可见(漏怪方/未入选的完美玩家/淘汰玩家/
// 观战席都能看到),因此 teamPanel 的联防 tooltip 是「正在驻守联防战场」;最终攻势 / 隐秘核心的配对框
// 仍是观看者相对的(「与你在同一战场」,淘汰/观战无框)。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { sameFieldmates, nameOf } from '../../public/js/battle/observe.js';
import { phaseBanner } from '../../public/js/ui/gameLogic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const player = (playerId, name) => ({ playerId, name, seat: Number(playerId[1]) - 1, alive: true, status: 'acting' });
const PUB = {
  players: [player('p1', '博士一'), player('p2', '博士二'), player('p3', '博士三'), player('p4', '博士四')],
  round: 9, combatMode: 'client',
};

describe('sameFieldmates — who fights beside the viewer', () => {
  test('最终攻势 / 隐秘核心: the seat pair of the own boss field', () => {
    const pub = { ...PUB, phase: PHASE.FINAL_ASSAULT, fields: [
      { fieldId: 'b1', kind: 'boss', players: ['p1', 'p3'] },
      { fieldId: 'b2', kind: 'boss', players: ['p2', 'p4'] },
    ] };
    assert.deepEqual(sameFieldmates(pub, 'p1'), ['p3']);
    assert.deepEqual(sameFieldmates(pub, 'p3'), ['p1'], 'symmetric');
    assert.deepEqual(sameFieldmates(pub, 'p2'), ['p4']);
    const hidden = { ...pub, phase: PHASE.HIDDEN_CORE, fields: pub.fields.map((f) => ({ ...f, kind: 'hidden' })) };
    assert.deepEqual(sameFieldmates(hidden, 'p4'), ['p2']);
  });

  test('联防: the frames mark the unite field defenders — the helpers only; a leaker is not on the field', () => {
    const pub = { ...PUB, phase: PHASE.UNITE, unite: { leakers: ['p1'], helpers: ['p2', 'p3'] }, fields: [
      { fieldId: 'u', kind: 'unite', players: ['p2', 'p3'] },
    ] };
    assert.deepEqual(sameFieldmates(pub, 'p1'), ['p2', 'p3'], 'the leaker sees the helpers defending their leaks');
    assert.deepEqual(sameFieldmates(pub, 'p2'), ['p3'], 'a helper sees only the other helper (≤ 2 frames)');
    assert.deepEqual(sameFieldmates(pub, 'p4'), ['p2', 'p3'], 'an unselected perfect player also reads the field: the helpers');
  });

  test('联防: 2 leakers + 2 helpers framed the whole team — now only the helpers (≤ 2), one defender → one frame', () => {
    const pub = { ...PUB, phase: PHASE.UNITE, unite: { leakers: ['p1', 'p2'], helpers: ['p3', 'p4'] } };
    assert.deepEqual(sameFieldmates(pub, 'p1'), ['p3', 'p4'], 'a leaker sees the two helpers');
    assert.deepEqual(sameFieldmates(pub, 'p3'), ['p4'], 'a helper sees the other helper, not the leakers');
    const solo = { ...PUB, phase: PHASE.UNITE, unite: { leakers: ['p1', 'p2', 'p3'], helpers: ['p4'] } };
    assert.deepEqual(sameFieldmates(solo, 'p1'), ['p4'], 'a lone defender → one frame');
    assert.deepEqual(sameFieldmates(solo, 'p4'), [], 'the lone helper has nobody beside them (self is never framed)');
  });

  test('联防: the frames describe the field — an eliminated player and a spectator seat see the helpers too', () => {
    const dead4 = { ...PUB, players: PUB.players.map((p) => (p.playerId === 'p4' ? { ...p, alive: false } : p)) };
    const unite = { leakers: ['p1'], helpers: ['p2', 'p3'] };
    assert.deepEqual(sameFieldmates({ ...dead4, phase: PHASE.UNITE, unite }, 'p4'), ['p2', 'p3'], 'eliminated: the markers describe the field, they still show who defends');
    assert.deepEqual(sameFieldmates({ ...PUB, phase: PHASE.UNITE, unite }, 's_spec'), ['p2', 'p3'], 'a spectator seat sees the helpers too');
    assert.deepEqual(
      sameFieldmates({ ...dead4, phase: PHASE.FINAL_ASSAULT, fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1', 'p2'] }] }, 'p4'),
      [], 'eliminated in the boss fight (pair frames are viewer-relative): nobody',
    );
    assert.deepEqual(sameFieldmates({ ...PUB, phase: PHASE.PREP, round: 14, bossPairing: [['p1', 'p2']] }, 'p4'), [], 'boss prep: an outsider is in no pair');
  });

  test('boss-round prep: the pairing is planned before the fight and rides pub.bossPairing', () => {
    const pub = { ...PUB, phase: PHASE.PREP, round: 14, bossPairing: [['p1', 'p3'], ['p2', 'p4']] };
    assert.deepEqual(sameFieldmates(pub, 'p1'), ['p3'], 'the frame shows while still deploying');
    assert.deepEqual(sameFieldmates(pub, 'p4'), ['p2']);
    assert.deepEqual(sameFieldmates(pub, 'p3'), ['p1'], 'symmetric');
    assert.deepEqual(sameFieldmates({ ...pub, bossPairing: [] }, 'p1'), [], 'published empty: nobody claimed');
    assert.deepEqual(sameFieldmates({ ...PUB, phase: PHASE.PREP, round: 8 }, 'p1'), [], 'a normal round: no bossPairing published at all');
  });

  test('empty outside the shared phases (各自行动: one field per player; prep has no battle fields)', () => {
    const combat = { ...PUB, phase: PHASE.COMBAT, fields: [
      { fieldId: 'f1', kind: 'normal', players: ['p1'] }, { fieldId: 'f2', kind: 'normal', players: ['p2'] },
    ] };
    assert.deepEqual(sameFieldmates(combat, 'p1'), []);
    assert.deepEqual(sameFieldmates({ ...PUB, phase: PHASE.PREP, fields: [] }, 'p1'), []);
    assert.deepEqual(sameFieldmates(null, 'p1'), []);
  });
});

describe('phaseBanner names the shared-field players', () => {
  const bossPub = { ...PUB, phase: PHASE.FINAL_ASSAULT, fields: [
    { fieldId: 'b1', kind: 'boss', players: ['p1', 'p3'] }, { fieldId: 'b2', kind: 'boss', players: ['p2', 'p4'] },
  ] };

  test('最终攻势: the pair in the sub, generic copy without a viewer or with no mate', () => {
    assert.equal(phaseBanner(PHASE.FINAL_ASSAULT, bossPub, 'p1').sub, '你与【博士三】在同一战场，击败敌方领袖');
    assert.equal(phaseBanner(PHASE.FINAL_ASSAULT, bossPub, 'p2').sub, '你与【博士四】在同一战场，击败敌方领袖');
    assert.equal(phaseBanner(PHASE.FINAL_ASSAULT, bossPub).sub, '击败敌方领袖', 'no myId: the old copy');
    assert.equal(
      phaseBanner(PHASE.FINAL_ASSAULT, { ...bossPub, fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1'] }] }, 'p1').sub,
      '击败敌方领袖', 'a solo boss field: nobody to name',
    );
  });

  test('隐秘核心: same naming; 联防: a helper reads 「你与【X】在同一战场」, a leaker reads the neutral roster', () => {
    assert.equal(phaseBanner(PHASE.HIDDEN_CORE, bossPub, 'p3').sub, '你与【博士一】在同一战场，被源石侵蚀的假想敌');
    const unite = { ...PUB, phase: PHASE.UNITE, unite: { leakers: ['p1'], helpers: ['p2', 'p3'] } };
    assert.equal(phaseBanner(PHASE.UNITE, unite, 'p2').sub, '你与【博士三】在同一战场，守住防线', 'a helper really shares the field with the other helper');
    assert.equal(phaseBanner(PHASE.UNITE, unite, 'p1').sub, '联防：博士二、博士三', 'a leaker is not on the unite field: the neutral helpers roster');
    assert.equal(
      phaseBanner(PHASE.UNITE, { ...PUB, phase: PHASE.UNITE, unite: { leakers: ['p1'], helpers: ['p2'] } }, 'p2').sub,
      '联防：博士二', 'a lone helper: nobody beside them, the roster names the field',
    );
    assert.match(phaseBanner(PHASE.UNITE, unite).sub, /^联防：博士二、博士三$/, 'no myId: the helpers list as before');
    assert.equal(phaseBanner(PHASE.UNITE, unite, 'p9').sub, '联防：博士二、博士三', 'an outsider / eliminated viewer: the neutral roster, never 「你与…同一战场」');
    assert.match(
      phaseBanner(PHASE.UNITE, { ...PUB, phase: PHASE.UNITE, unite: { helpers: [] } }, 'p9').sub,
      /完美作战|联防/, 'an outsider with no field: the generic copy',
    );
  });

  test('unknown player ids still display (队友)', () => {
    assert.equal(nameOf({ players: [] }, 'pX'), '队友');
    const pub = { ...PUB, phase: PHASE.FINAL_ASSAULT, fields: [{ fieldId: 'b1', kind: 'boss', players: ['p1', 'pX'] }] };
    assert.equal(phaseBanner(PHASE.FINAL_ASSAULT, pub, 'p1').sub, '你与【队友】在同一战场，击败敌方领袖');
  });
});

test('the game screen passes the viewer to the banner and the team panel frames the avatar (hooks components: source)', () => {
  assert.match(read('public/js/screens/game.js'), /phaseBanner\(phase, pub, myId, alive\)/);
  const panel = read('public/js/ui/teamPanel.js');
  assert.match(panel, /import \{ sameFieldmates \} from '\.\.\/battle\/observe\.js'/);
  assert.match(panel, /const mates = new Set\(sameFieldmates\(pub, myId\)\)/);
  assert.match(panel, /mates\.has\(p\.playerId\)/);
  assert.match(panel, /same && 'is-same'/, 'the row carries the frame state');
  assert.match(panel, /pavatar--same/, 'the avatar carries the frame class');
  assert.match(panel, /与你在同一战场/, 'the tooltip explains the frame');
  assert.match(read('public/css/screens/game.css'), /\.team__row\.is-same \.pavatar \{/);
  assert.match(read('server/match/Match.js'), /v\.bossPairing = this\.bossWaves\.map/, 'the server publishes the prep pairing');
});
