// test/render/makoto-forms.test.js — the persona 替身 forms of 结城理 (collab-kits, playtest #38): the client's
// FORMS entry for char_4217_makoto (public/js/render/units.js) maps the sim's form fx (doll1 / doll2 / doll3 /
// doll3p2) onto the Doll_Skill_N_* clip sets inside her skeleton (data/assets.json manifest, verified here), and
// UnitView.setForm plays the change clip then holds the persona roles. Headless fake PIXI (fakepixi.js).
// Run: node --test test/render/makoto-forms.test.js

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
const MAKOTO = 'char_4217_makoto';

let fake, UnitView, FORMS;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, FORMS } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const tick = () => new Promise((r) => setImmediate(r));
const cam = () => presetCamera('normal', { width: 1280, height: 720 });

/** Asset store with the real manifest entry of her skeleton and its animation names (the front set). */
function store(id) {
  const entry = assets.chars[id].spine.front;
  const names = Object.keys(entry.animations || {});
  return {
    picture: () => null,
    image: async () => null,
    spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: names.map((name) => ({ name })) }), release() {} },
  };
}

async function makoto(info = {}) {
  const ctx = fakeViewCtx(fake.P, { assets: store(MAKOTO), cam });
  const v = new UnitView(ctx, { id: 7, side: 'ally', kind: 'op', defId: MAKOTO, spine: MAKOTO, tier: 6, golden: true, x: 8, y: 9, maxHp: 3000, facing: -1, ...info });
  await tick(); await tick();
  assert.ok(v.actor, 'Spine model built');
  return v;
}
const clip = (v) => v.actor.current;
const frames = (v, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) v.update(dt, cam(), i * dt); };

test('the FORMS entry names only clips her skeleton really has (the Doll_Skill_N_* persona sets)', () => {
  const anims = assets.chars[MAKOTO].spine.front.animations;
  const forms = FORMS[MAKOTO];
  assert.ok(forms, 'a FORMS entry exists for her');
  for (const kind of ['doll1', 'doll2', 'doll3', 'doll3p2']) {
    const f = forms[kind];
    assert.ok(f, kind);
    for (const name of [f.change, f.leave, f.roles.idle, f.roles.die, f.roles.attack?.loop]) {
      if (name != null) assert.ok(name in anims, `${kind}: ${name}`);
    }
  }
  assert.equal(forms.doll3p2.change, 'Doll_Skill_3_P1toP2_ChangeBegin', 'the lethal switch plays the official change clip');
});

test('the forms: each set starts with its own SwitchIn and holds its persona clips; the P1toP2 change plays on the switch', async () => {
  { // S3 (Thanatos, P1)
    const v = await makoto();
    v.setForm('doll3');
    assert.equal(clip(v), 'Doll_Skill_3_P1_SwitchIn', 'the entering clip first');
    frames(v, 70);                                  // SwitchIn is 1 s
    assert.equal(clip(v), 'Doll_Skill_3_P1_Idle', 'the P1 idle');
    v.die();
    assert.equal(clip(v), 'Doll_Skill_2_Die', 'P1 has no Die clip of her own — S2\'s Thanatos Die [ASSUMED]');
  }
  { // the lethal switch to Orpheus (P2)
    const v = await makoto();
    v.setForm('doll3p2');
    assert.equal(clip(v), 'Doll_Skill_3_P1toP2_ChangeBegin', 'the P1toP2 change');
    frames(v, 40);                                  // ChangeBegin is 0.5 s
    assert.equal(clip(v), 'Doll_Skill_3_P2_Loop', 'the P2 idle');
    v.setForm(null);
    assert.equal(clip(v), 'Doll_Skill_3_P2_SwitchOut', 'the 替身 ends back to her own model');
    const w = await makoto({ form: 'doll3p2' });
    w.die();
    assert.equal(clip(w), 'Doll_Skill_3_P2_Die', 'Orpheus dies on her own clip');
  }
  { // S1 (Orpheus) / S2 (Thanatos): their own sets
    const v1 = await makoto();
    v1.setForm('doll1');
    assert.equal(clip(v1), 'Doll_Skill_1_SwitchIn');
    frames(v1, 70);
    assert.equal(clip(v1), 'Doll_Skill_1_Idle');
    v1.onAttack?.(null, 1.2);
    assert.equal(clip(v1), 'Doll_Skill_1_Attack', 'S1 keeps her attack clip');
    const v2 = await makoto();
    v2.setForm('doll2');
    assert.equal(clip(v2), 'Doll_Skill_2_SwitchIn');
    frames(v2, 70);
    assert.equal(clip(v2), 'Doll_Skill_2_Loop', 'S2 has no attack clip of its own [ASSUMED]');
  }
});

test('a view built while the 替身 is out starts in the persona set without replaying the change (info.form)', async () => {
  const v = await makoto({ form: 'doll3' });
  assert.equal(v.form, 'doll3');
  assert.equal(clip(v), 'Doll_Skill_3_P1_Idle', 'no SwitchIn replay for a view built in the set');
});
