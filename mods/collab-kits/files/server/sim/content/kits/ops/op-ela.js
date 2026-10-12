// server/sim/content/kits/ops/op-ela.js — 艾拉 (char_4123_ela) 自选 operator kit: 6★ 陷阱师 (特种), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes the collab
// operators); every skill, both talents and the module at every form. Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4123_ela, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) / 3 (tier 6). Potential 0 [ASSUMED: no account].
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 艾拉; the
// placeable-token machinery (data/backups.json tokens.token_10033_ela_grzmot: placeable, deployLimit 4) and the
// mid-battle placements auto-placed as 望's stones are (kits README "How to add an operator (自选)" — summons).
// - T0 雷鸣地雷: her 雷鸣地雷 traps (up to 4 on the field). A trap triggers when the first enemy comes within its
//   bb projectile_range (1.7 — the adjacent ring) and applies the effect of HER SELECTED SKILL's passive
//   (S1 停顿 + the hit-rate cut, S2 晕眩, S3 停顿 + 脆弱), marking the targets (T1's trap-affected). The physical /
//   magical hit-rate cut of S1 has no engine stat [ASSUMED: not modelled]. "撤退时以自身为中心触发一次雷鸣地雷效果"
//   — her retreat (and death) sets off the effect around her.
// - T1 “正中靶心” "攻击有30%几率造成相当于攻击力160%的物理伤害，对受到雷鸣地雷效果影响的目标必定触发": the hit
//   hook — every attack hit on a mine-marked target, and 30 % (bb prob) of the rest, adds one ATK × atk_scale (160 %)
//   physical instance.
// - S1 眩目阻滞 (time SP): the passive above; the active auto-places one mine beside her (the +1 stock, as the traper's
//   mid-battle placements auto-place).
// - S2 震荡坚守 (attack SP, 20 s): the passive above; DEF +def (250 %), her attacks splash (radius 1.3 [ASSUMED]) and
//   ignore def_penetrate_fixed (500) DEF; [ASSUMED: the attack-range shrink (attack@projectile_range 1.1) is not
//   modelled — the closerange record carries no alternative grid]; one mine at the end.
// - S3 “博萨克风暴” (time SP, 40 rounds): the passive above; ATK +atk (60 %), the interval shorter by base_attack_time
//   (bb −0.35 ⇒ batPct), [ASSUMED: the mine-priority targeting is not modelled — the engine's priority takes fixed
//   keys]; two mines at the end.
// - uniequip_002_ela (XXI-Y): "自身可以额外部署在近战位，陷阱可以额外部署在远程位" — placement legality is match-side
//   (buildable_type 3, the talent change index 2) [ASSUMED: not modelled — no server/match consumer].

import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_ela_1', S2 = 'skchr_ela_2', S3 = 'skchr_ela_3';
const MINE = 'token_10033_ela_grzmot';
const MINE_RADIUS = 1.7;   // the bb projectile_range of every variant (the trigger ring)
const MINE_CAP = 4;        // "最多拥有4个"
const SPLASH_RADIUS = 1.3; // [ASSUMED] the S2 splash

const minesOf = (battle, unit) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === MINE && t.ownerUnit === unit && t.alive);

/** The mine effect of her SELECTED skill (S1 停顿+命中, S2 晕眩, S3 停顿+脆弱), around tile (r, c), marking the targets. */
function mineEffect(battle, ela, r, c) {
  const sid = ela.skill?.id;
  const rec = sid && skillRec(ela.def, sid);
  const bb = rec?.bb ?? {};
  const list = battle.enemies.filter((e) => {
    if (!e.alive || e.side !== 'enemy') return false;
    return Math.max(Math.abs(e.tileR - r), Math.abs(e.tileC - c)) <= MINE_RADIUS;
  });
  for (const e of list) {
    if (sid === S2) {
      battle.applyStatus(e, 'stun', { duration: num(bb.stun, 4), source: ela });
    } else if (sid === S3) {
      battle.applyStatus(e, 'sluggish', { duration: num(bb.sluggish, 6), source: ela });
      battle.applyStatus(e, 'fragile', { duration: num(bb['weak[limit]'], 6), value: num(bb.damage_scale, 0.25), source: ela });
    } else {
      battle.applyStatus(e, 'sluggish', { duration: num(bb.sluggish, 9), source: ela });
      // the bb's 物理/法术命中率 −30 % has no engine stat [ASSUMED: not modelled]
    }
    battle.addBuff(e, { key: 'ela:mine', duration: num(bb.sluggish ?? bb.stun, 6), tags: ['debuff'] });
  }
  return list.length;
}

/** One 雷鸣地雷 placed beside `ela` (the mid-battle +1 / +2 stocks), with its trigger kit; capped at 4 live mines. */
function placeMine(battle, ela) {
  if (minesOf(battle, ela).length >= MINE_CAP) return null;
  for (let r = ela.tileR - 1; r <= ela.tileR + 1; r++) {
    for (let c = ela.tileC - 1; c <= ela.tileC + 1; c++) {
      if (!battle.grid.inRect(r, c) || !battle.grid.isLow(r, c)) continue;
      const occ = battle.enemies.some((e) => e.alive && e.tileR === r && e.tileC === c);
      if (occ) continue;
      const t = battle.spawnToken(ela, MINE, r, c, { anySource: true });
      if (t) {
        armMine(battle, t, ela);
        return t;
      }
    }
  }
  return null;
}

/** The trigger kit of one placed mine: the first enemy of the ring sets off the selected skill's effect. */
function armMine(battle, trap, ela) {
  battle.every(0.15, () => {
    if (!trap.alive || !trap.deployed) return;
    const foe = battle.enemies.find((e) => e.alive && e.side === 'enemy' && !e.isFlying
      && Math.max(Math.abs(e.tileR - trap.tileR), Math.abs(e.tileC - trap.tileC)) <= MINE_RADIUS);
    if (!foe) return;
    mineEffect(battle, ela, trap.tileR, trap.tileC);
    battle.retreat(trap, { reason: 'triggered', permanent: true });
  }, { owner: trap });
}

export default {
  char_4123_ela: (bb, chess) => {
    const t1 = talentBb(chess, 1);            // “正中靶心”: atk_scale 1.6, prob 0.3
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);

    return {
      skills: {
        // 眩目阻滞: the passive rides the mines; the active places one
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) { placeMine(battle, unit); },
        },
        // 震荡坚守: DEF +250 %, splashing, DEF −500; one mine at the end
        [S2]: {
          kind: 'duration',
          mods: { defPct: num(s2?.bb?.def, 2.5), defIgnoreFlat: num(s2?.bb?.def_penetrate_fixed, 500) },
          attack: { splashRadius: SPLASH_RADIUS, splashScale: 1 },
          onEnd({ battle, unit }) { if (up(unit)) placeMine(battle, unit); },
        },
        // “博萨克风暴”: 40 rounds of faster, harder attacks; two mines at the end
        [S3]: {
          kind: 'ammo',
          ammo: 40,
          mods: { atkPct: num(s3?.bb?.atk, 0.6), batPct: num(s3?.bb?.base_attack_time, -0.35) },
          onEnd({ battle, unit }) {
            if (!up(unit)) return;
            placeMine(battle, unit);
            placeMine(battle, unit);
          },
        },
      },
      talents: [
        { install(battle, unit) {   // 雷鸣地雷: arm every mine of hers; her retreat / death sets one off around her
          const armAll = () => {
            for (const t of battle.allyUnits) {
              if (t.kind !== 'token' || t.defId !== MINE || t.ownerUnit !== unit || !t.alive || !t.deployed) continue;
              if (t.kit && !t.kit.generic) continue;
              armMine(battle, t, unit);
            }
          };
          armAll();
          battle.on('deploy', (c) => { if (c.unit === unit) armAll(); }, { owner: unit });
          const boom = () => { if (unit.mem.elaDead) return; unit.mem.elaDead = true; mineEffect(battle, unit, unit.tileR, unit.tileC); };
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.elaDead = false; }, { owner: unit });
          battle.on('death', (c) => { if (c.unit === unit && c.reason === 'retreat') boom(); }, { owner: unit });
        } },
        { install(battle, unit) {   // “正中靶心”: 30 % / guaranteed-on-marked bonus instance
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
            const marked = !!c.target.findBuff('ela:mine');
            if (!marked && !battle.rng.chance(num(t1.prob, 0.3))) return;
            battle.dealDamage(unit, c.target, { amount: unit.s.atk * num(t1.atk_scale, 1.6), type: 'phys', tags: ['talent', 'ela:bull'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // 雷鸣地雷: the prep-placed mines of her loadout arrive as hand pieces — arm them here too
        battle.every(1, () => { if (up(unit)) { for (const t of minesOf(battle, unit)) if (!t.kit || t.kit.generic) armMine(battle, t, unit); } }, { owner: unit });
      },
    };
  },
};
