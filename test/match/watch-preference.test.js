// watch preference: eliminated humans and spectator seats follow the player they last watched manually (a g.watch
// records the preference) through every phase reset — prep scouting, server combat, client combat, boss fields,
// reconnect; a dead preference falls back to the first seated human still in, and the automatic assignments never
// touch the preference itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = 's_spec';

test('watch preference: prep: a round starts an eliminated viewer on the board they last watched; a spectator falls back to the first human in', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1001, fake: true, spectators: [S] }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the manual scout records the preference');
  h.ps('p_0').eliminate(1);
  h.toPrep(2);
  assert.equal(m.watchers.get('p_0'), 'n:p_1', 'the eliminated viewer is scouting their preference again');
  const meta = h.lastTo('p_0', 'm.field');
  assert.equal(meta?.fieldId, 'n:p_1');
  assert.equal(meta?.prep, true, 'the prep board itself was pushed');
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the automatic assignment left the preference alone');
  assert.equal(m.watchers.get(S), 'n:p_1', 'the spectator (no preference) follows the first human still in');
  m.dispose();
});

test('watch preference: prep: a dead preference falls back to the first seated human still in', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1002, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.ps('p_2').eliminate(1);
  h.toPrep(2);
  assert.equal(m.watchers.get('p_0'), 'n:p_1', 'p_2 is gone → the first human still in (p_1)');
  m.dispose();
});

test('watch preference: server combat: the default watch starts an eliminated viewer on their preference; a mid-phase manual switch re-records it', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1003, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.runToPhase(PHASE.COMBAT, 1);
  assert.equal(m.watchers.get('p_0'), 'n:p_2');
  assert.equal(m.watchers.get('p_1'), 'n:p_1', 'a fighting player stays on their own field');
  assert.equal(m.watchers.get('p_2'), 'n:p_2');
  assert.equal(m.watchPref.get('p_0'), 'p_2', 'the combat assignment did not touch the preference');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchers.get('p_0'), 'n:p_1');
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the manual switch is the new preference');
  m.dispose();
});

test('watch preference: client combat: an eliminated human is started on the field of the player they last watched', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1004, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.runToPhase(PHASE.COMBAT, 1);
  const start = h.lastTo('p_0', 'b.start');
  assert.equal(start?.watch, true);
  assert.equal(start?.fieldId, 'n:p_2', "the preference's field, not the first seat's");
  assert.equal(m.watchers.get('p_0'), 'n:p_2');
  m.dispose();
});

test('watch preference: reconnect: an eliminated viewer is put back on their preference', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 1005, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  h.ps('p_0').eliminate(1);
  h.runToPhase(PHASE.COMBAT, 1);
  m.onDisconnect('p_0');
  m.onReconnect('p_0');
  const start = h.lastTo('p_0', 'b.start');
  assert.equal(start?.watch, true);
  assert.equal(start?.fieldId, 'n:p_2');
  m.dispose();
});

test('watch preference: Final Assault: an eliminated viewer is started on the boss field of the player they last watched', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 4, seed: 54, fake: true, instant: false, script: (b) => (b.kind === 'boss' ? { bossDps: 1 } : {}) }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.ps('p_3').eliminate(13);
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true }, 'records the preference during prep');
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  assert.deepEqual(m.fields.map((f) => [f.fieldId, f.players]), [['b1', ['p_0', 'p_1']], ['b2', ['p_2']]]);
  assert.equal(m.watchers.get('p_3'), 'b2', 'follows p_2 into b2 without a manual tap');
  assert.equal(m.watchers.get('p_0'), 'b1', 'a fighting player stays on their own boss field');
  // review: a shared field's g.watch records nothing — its id does not say which of its players was tapped
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b1' }), { ok: true });
  assert.equal(m.watchPref.get('p_3'), 'p_2', 'the shared b1 left the preference alone (it would name p_0 or p_1)');
  assert.deepEqual(m.handle('p_3', { t: 'g.watch', fieldId: 'b2' }), { ok: true });
  assert.equal(m.watchPref.get('p_3'), 'p_2', 'the single-player b2 records it');
  m.dispose();
});

test('watch preference: review: a spectator seat joining during prep is sent the scouted board (client combat)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1006, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  m.addSpectator(S);
  const meta = h.lastTo(S, 'm.field');
  assert.equal(meta?.fieldId, 'n:p_0', 'no preference → the first seated human still in');
  assert.equal(meta?.prep, true);
  assert.equal(m.watchers.get(S), 'n:p_0', 'registered as a scout, so later board changes push again');
  m.dispose();
});

test('watch preference: review: an eliminated human reconnecting during prep is sent the scouted board (client combat)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1007, fake: true, clientCombat: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  h.ps('p_0').eliminate(1);
  m.onDisconnect('p_0');
  m.onReconnect('p_0');
  const meta = h.lastTo('p_0', 'm.field');
  assert.equal(meta?.fieldId, 'n:p_1', 'the preference survived the disconnect');
  assert.equal(meta?.prep, true);
  assert.equal(m.watchers.get('p_0'), 'n:p_1');
  m.dispose();
});

test('watch preference: review 2: watching your own board again does not wipe the remembered teammate', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 1008, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_1' }), { ok: true });
  assert.equal(m.watchPref.get('p_0'), 'p_1');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true }, '返回战场 / the own row still switches to the own board');
  assert.equal(m.watchers.get('p_0'), 'n:p_0');
  assert.equal(m.watchPref.get('p_0'), 'p_1', 'the self-watch left the preference alone');
  m.dispose();
});

test('watch preference: review 2: a 联防 field records no preference (its players are only the helpers)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 3, seed: 1009, fake: true, clientCombat: true, script: (b) => (b.kind === 'normal' && b.round === 1 ? { duration: 1, leaks: { p_0: 4 } } : { duration: 1 }) }).start();
  h.toPrep(1);
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'n:p_2' }), { ok: true });
  assert.equal(m.watchPref.get('p_0'), 'p_2');
  h.ps('p_2').eliminate(1);
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(m.fields.find((f) => f.fieldId === 'u')?.players, ['p_1'], 'single-helper precondition');
  assert.deepEqual(m.handle('p_0', { t: 'g.watch', fieldId: 'u' }), { ok: true });
  assert.equal(m.watchers.get('p_0'), 'u');
  assert.equal(m.watchPref.get('p_0'), 'p_2', "the unite field recorded nothing — a lone helper 'p_1' was not written over it");
  m.dispose();
});

test('watch preference: field report: the adoption un-marks the scouted board the phase reset marked stale, before watching it', () => {
  const src = readFileSync(join(ROOT, 'public/js/screens/game.js'), 'utf8');
  const i = src.indexOf('const autoScoutRef = useRef(null)');
  assert.ok(i > 0, 'the adoption effect exists');
  const body = src.slice(i, i + 1200);
  const unmark = body.indexOf('if (staleFieldRef.current === field) staleFieldRef.current = null;');
  const watch = body.indexOf('setWatching(fid);');
  assert.ok(unmark > 0, 'the adopted board is un-marked from staleFieldRef');
  assert.ok(watch > unmark, 'un-marked before setWatching, so the re-entry is not refused');
});
