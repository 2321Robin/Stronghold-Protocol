// server/sim/content/kits/ops/op-makoto.js — 结城理 (char_4217_makoto) 自选 operator kit: 6★ 人偶师 (特种), an owned-6★
// pick of the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes the collab
// operators); every skill and both talents at every form. Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// The <替身> (Persona) state itself is the dollkeeper archetype (professions.js installDollkeeper): a fatal hit enters
// it for the trait's bb duration (20 s), 阻挡数 0, the HP reset and the switch animation are the engine's. The kit rides
// the archetype's `dollSwap` { unit, form } event and `unit.trait.doll`:
//   * T0 不羁之力: entering the 替身 停顿s the enemies around her for bb sluggish (8 s) [ASSUMED radius 1.5]; while the
//     替身 is out she fights as the persona — ATK +atk, the interval grows by base_attack_time (0.4 s) and HP +max_hp
//     (the trait bb's 替身 HP share, which the archetype does not apply itself [ASSUMED: kit-side as a hpPct buff]).
//   * T1 S.E.E.S.队长: when the 替身 ends (the switch back), every enemy around her [ASSUMED: she is the only
//     S.E.E.S. member the mode can field] within a radius [ASSUMED 1.5] takes ATK × atk_scale (450 %) TRUE damage.
//   * The skills (dur 0, data SKILL_RANGE — an enemy in the skill's range casts): each cast switches to the 替身 at once
//     (the dollSwitch hook, as 归溟幽灵鲨 S2) and (re)selects the persona: S1 Orpheus, S2 Thanatos, S3 Thanatos first and
//     Orpheus from the second cast on. The persona shapes her attacks as an arts rider of ATK × the selected skill's
//     attack@atk_scale [ASSUMED: the official replaces the attack; the rider keeps the frame]: S2's Thanatos adds the
//     fear chance and executes a target below ATK × attack@kill_atk_scale (the execute before the rider, both before the
//     hit's own damage lands? — the execute rides the same hit [ASSUMED]); S1's Orpheus heals the most-wounded ally in
//     her range attack@heal_scale (50 %) when no enemy is in it (as 玛露西尔 S1); S3's Orpheus: 阻挡数 +2 and the allies
//     in her range gain 35 % physical / arts dodge with a heal pulse of attack@heal_scale (30 %) per second on up to
//     attack@max_target_heal (4) allies [ASSUMED: the pulse rides the persona, not the skill's 0-duration window].
// - uniequip_002_makoto: the trait bb duration 20 / max_hp 0.2 — the trait's own values (the archetype's duration and
//   the kit-side HP share read them per the picked module's traitOverride); the attributes ride the stats.

import { num, talentBb, traitBb, skillRec, enemiesInGrid, up } from '../shared/tier1.js';

const S1 = 'skchr_makoto_1';
const S2 = 'skchr_makoto_2';
const S3 = 'skchr_makoto_3';

const AURA_RADIUS = 1.5;   // [ASSUMED] the 周围 radius of the T0 pause, T1 total attack and the S3 ally aura

export default {
  char_4217_makoto: (bb, chess) => {
    const t0 = talentBb(chess, 0);            // 不羁之力: atk, base_attack_time, sluggish, max_hp_t1
    const t1 = talentBb(chess, 1);            // S.E.E.S.队长: atk_scale
    const tb = traitBb(chess);                // the trait (the module's traitOverride when picked): duration, max_hp
    const s1 = skillRec(chess, S1), s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);

    return {
      skills: {
        [S1]: {   // 俄耳甫斯的竖琴: switch to the 替身, the persona is Orpheus
          kind: 'instant',
          onStart({ battle, unit }) {
            unit.mem.makotoPersona = 'orpheus';
            battle.emit('dollSwitch', { unit });
          },
        },
        [S2]: {   // 塔纳托斯的囚锁: switch to the 替身, the persona is Thanatos
          kind: 'instant',
          onStart({ battle, unit }) {
            unit.mem.makotoPersona = 'thanatos';
            battle.emit('dollSwitch', { unit });
          },
        },
        [S3]: {   // 开辟明日的剑刃: Thanatos first, Orpheus from the second cast on
          kind: 'instant',
          onStart({ battle, unit }) {
            const first = unit.mem.makotoPersona == null;
            unit.mem.makotoPersona = first || (unit.mem.makotoPersona === 'orpheus' ? 'thanatos' : 'orpheus');
            if (first) unit.mem.makotoPersona = 'thanatos';
            battle.emit('dollSwitch', { unit });
          },
        },
      },
      talents: [
        { install(battle, unit) {   // T0 + T1: the entering 停顿, the persona's stat shape, the ending total attack
          battle.on('dollSwap', (c) => {
            if (c.unit !== unit) return;
            if (c.form === 'doll') {
              for (const e of battle.enemies) {
                if (!e.alive || e.side !== 'enemy') continue;
                if (Math.max(Math.abs(e.tileR - unit.tileR), Math.abs(e.tileC - unit.tileC)) <= AURA_RADIUS) {
                  battle.applyStatus(e, 'sluggish', { duration: num(t0.sluggish, 8), source: unit });
                }
              }
            } else {
              for (const e of battle.enemies) {
                if (!e.alive || e.side !== 'enemy') continue;
                if (Math.max(Math.abs(e.tileR - unit.tileR), Math.abs(e.tileC - unit.tileC)) <= AURA_RADIUS) {
                  battle.dealDamage(unit, e, { amount: unit.s.atk * num(t1.atk_scale, 4.5), type: 'true', tags: ['talent', 'makoto:total'] });
                }
              }
            }
          }, { owner: unit });
          const shape = () => {
            const want = up(unit) && !!unit.trait.doll;
            const has = unit.findBuff('makoto:persona');
            if (want && !has) {
              battle.addBuff(unit, { key: 'makoto:persona', tags: ['trait'], mods: {
                atkPct: num(t0.atk, 0.85), hpPct: num(tb.max_hp, num(t0.max_hp_t1, 0.35)), batPct: num(t0.base_attack_time, 0.4),
              } });
            } else if (!want && has) battle.removeBuff(unit, 'makoto:persona');
          };
          battle.on('tick', shape, { owner: unit });
          battle.on('battleStart', shape, { owner: unit });
        } },
        { install(battle, unit) {   // the persona's attack rider + the S1 heal branch + the S3 ally aura
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || !c.target || c.target.side !== 'enemy' || !unit.trait.doll) return;
            const sid = unit.skill?.id;
            if (sid === S2) {
              if (c.target.alive && c.target.hp < unit.s.atk * num(s2?.bb?.['attack@kill_atk_scale'], 2.5)) {
                battle.dealDamage(unit, c.target, { amount: num(s2?.bb?.['attack@kill_damage'], 9999999), type: 'true', tags: ['skill', 'makoto:execute'] });
              }
              if (battle.rng.chance(num(s2?.bb?.['attack@prob'], 0.35))) battle.applyStatus(c.target, 'fear', { duration: num(s2?.bb?.['attack@fear'], 1.5), source: unit });
            }
            const scale = num(skillRec(chess, sid)?.bb?.['attack@atk_scale'], 2.1);
            if (c.target.alive) battle.dealDamage(unit, c.target, { amount: unit.s.atk * scale, type: 'arts', tags: ['skill', 'makoto:persona'] });
          }, { owner: unit });
          battle.every(1.0, () => {   // S1's Orpheus: a wounded ally in range heals when no enemy is in hers
            if (!up(unit) || !unit.trait.doll || unit.skill?.id !== S1) return;
            if (enemiesInGrid(battle, unit, null).length) return;
            const allies = battle.allyUnits.filter((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed
              && a.hpRatio < 0.5 && (unit.rangeKeys || []).includes(a.tileR * 21 + a.tileC));
            const most = allies.sort((a, b) => a.hpRatio - b.hpRatio)[0];
            if (most) battle.heal(unit, most, unit.s.atk * num(s1?.bb?.['attack@heal_scale'], 0.5), { tags: ['skill', 'makoto:heal'] });
          }, { owner: unit });
          battle.every(0.5, () => {   // S3's Orpheus: the ally dodge aura and the heal pulse
            if (!up(unit) || !unit.trait.doll || unit.skill?.id !== S3 || unit.mem.makotoPersona !== 'orpheus') return;
            const dodge = 0.35, healScale = num(s3?.bb?.['attack@heal_scale'], 0.3), maxN = Math.max(1, Math.floor(num(s3?.bb?.['attack@max_target_heal'], 4)));
            const allies = battle.allyUnits.filter((a) => a.kind === 'op' && a.alive && a.deployed
              && Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC)) <= AURA_RADIUS);
            for (const a of allies) {
              battle.addBuff(a, { key: 'makoto:aura', duration: 0.6, refresh: 'replace', source: unit, mods: { dodgePhys: dodge, dodgeArts: dodge }, tags: ['skill'] });
            }
            for (const a of allies.slice().sort((x, y) => x.hpRatio - y.hpRatio).slice(0, maxN)) {
              battle.heal(unit, a, unit.s.atk * healScale, { tags: ['skill', 'makoto:pulse'] });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) {   // S3's in-persona switch: while Thanatos is out, one free recast summons Orpheus
          battle.on('dollSwap', (c) => {
            if (c.unit === unit && c.form == null) unit.mem.makotoS3Switched = false;   // the next window switches again
          }, { owner: unit });
          battle.every(0.25, () => {
            const sk = unit.skill;
            if (!sk || sk.id !== S3 || !up(unit) || !unit.trait.doll) return;
            if (unit.mem.makotoS3Switched || sk.opCooling || unit.s.flags.silence) return;
            unit.mem.makotoS3Switched = true;
            sk.activate('doll', { free: true });                     // 阻回 holds the bar; the switch is the point
          }, { owner: unit, immediate: true });
        } },
      ],
    };
  },
};
