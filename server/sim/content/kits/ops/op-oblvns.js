// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 领主 (近卫), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots (data/backups.json diy.ownedPool; the local SP_DIY_COLLAB build,
// playtest #21 — upstream excludes the collab operators); every skill, both talents, the trait and the LOR-Y module at
// every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4182_oblvns, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no
// module; elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Potential 0 [ASSUMED: no
// account]. Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS
// 丰川祥子 (talent / skill / Fever 备注); a prior full implementation of the same kit, upstream PR #178
// (kits/custom-oblvns.js, closed unmerged) — its behaviour reading and [ASSUMED] constants are kept where no source
// settles them.
// - Trait (领主) "可以进行远程攻击，但此时攻击力降低至80%": the lord profile (professions.js: ×atk_scale unless the
//   target stands on her tile / the tile in front or she blocks it; she hits air, data canHitFly), range 3-10. No kit
//   code for the scale itself — the engine reads trait.bb.atk_scale.
// - T1 颂乐音符 "攻击会演奏追踪敌人的音符，音符飘出攻击范围一段时间后消失。每存在一个音符，Ave Mujica成员无视敌人3%的
//   防御力和2%法术抗性（最多叠加至10层）": every attack hit plays a note (≤ max_cnt), the notes decay one per second
//   after `delay` 1 s without an attack; per note every Ave Mujica member gains def/res ignore (buff mods
//   defIgnorePct / resIgnorePct × notes) — no range bound (PRTS: no 攻击范围内 qualifier). LOR-Y stage 3 raises the
//   numbers (5% / 2.5% / 12 layers, the module's talent change merged into the talent bb) and adds "技能期间远程攻击
//   不再降低攻击力" (the S3 spec's attack profile).
// - T2 毋畏遗忘 "对敌人造成伤害时使Fever+3；其他Ave Mujica成员的攻击范围若与自身原本攻击范围重合，则将其视作攻击范围的
//   延伸；攻击范围内干员攻击速度+12": every damage instance she deals a living enemy (any type) feeds the Fever meter;
//   at FEVER_MAX the Fever runs FEVER_TIME s [ASSUMED both — no published numbers; PR #178's reading], during it the
//   meter does not fill [ASSUMED]; the operators (kind op) on tiles of her current range get ASPD +attack_speed.
//   The range-overlap clause names OTHER Ave Mujica members — void while she is the only one the mode can field
//   [ASSUMED: not modelled; two 丰川祥子 (coop, tier 5 + tier 6) would need it].
// - S1 新月的苏醒 (MANUAL, attack SP, data 充能2次): one cast = 8 arts notes of ATK × atk_scale…atk_scale_8 (decaying,
//   from the data), each tracking the standard target order (cycling when fewer enemies); "充能至最大层数时自动释放
//   一次" — the install casts it as soon as both charges are held (the 3 s operation cooldown applies).
// - S2 满月的舞会 (MANUAL): each cast switches the timbre — 钢琴（初始）→ 风琴 → 钢琴 … [ASSUMED: alternation; the
//   official switch UI is not modelled] — and replaces the stance buff (钢琴 ATK +attack@atk, 风琴 ASPD
//   +attack@attack_speed). While a stance is taken the timbre colours her attacks: 风琴 notes deal 法术伤害 (the hit
//   hook rewrites the attack type), 钢琴 notes pierce (穿过敌人): the enemies on the PIERCE_TILES [ASSUMED 3] tiles
//   past the target along her facing take the same physical damage. Fever 期间变为当前音色的二连击: every attack is
//   followed by one free extra attack (no ammo; SP exempt as a skill-driven attack).
// - S3 残月的余响 (MANUAL, 25 s, data duration; range = the skill's own grid, the trigger's customRangeGrid): every
//   attack adds 2 physical notes of ATK × attack@atk_scale tracking the highest-RES enemy and 2 arts notes tracking
//   the highest-DEF enemy (of her current — expanded — range plus the ones she blocks). "Fever期间Ave Mujica成员受到
//   致命伤害时不撤退，Fever结束后退场": the fatal hook prevents the death of an Ave Mujica member while the Fever and
//   the skill run; the T2 watcher retires (battle.retreat) whoever was saved once the Fever ends.

import { num, talentBb, skillRec, onHitBy, installAura, up } from '../shared/tier1.js';
import { COLS, ROWS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';
import { sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2';
const S3 = 'skchr_oblvns_3';

// The constants absent from the official tables [ASSUMED] (PR #178's readings).
const FEVER_MAX = 100;    // the Fever meter has no published threshold
const FEVER_TIME = 10;    // a Fever lasts 10 s
const NOTE_TICK = 0.25;   // the Fever / note poller
const PIERCE_TILES = 3;   // how far past the target a piano note pierces (text: 穿过敌人)
const AIR = Object.freeze({ canHitFly: true });

/** An Ave Mujica member on the field: 丰川祥子 is the only one the mode can field (a DIY pick, teamId mujica). */
const isMujica = (u) => !!u && u.alive && u.deployed && u.def?.charId === 'char_4182_oblvns';
const feverOf = (battle, u) => battle.time < (u.mem.oblvnsFeverUntil ?? -Infinity);

export default {
  char_4182_oblvns: (bb, chess) => {
    const t0 = talentBb(chess, 0);            // 颂乐音符 (the LOR-Y stage-3 change is merged in when the module is picked)
    const t1 = talentBb(chess, 1);            // 毋畏遗忘
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const notesMax = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
    const defPen = num(t0.def_penetrate_ratio);          // per note
    const resPen = num(t0.magic_resist_penetrate_ratio);
    const noteDelay = num(t0.delay, 1);
    const feverCnt = num(t1.cnt, 3);
    const auraAspd = num(t1.attack_speed, 12);
    // the LOR-Y trait part (攻击范围内存在2名及以上敌人时攻击速度+12) is the engine's generic rule since 0.2.2
    // (sim/content/traitMods.js, the 圣约送葬人 / 隐德来希 REA-Y shape) — never applied here
    // LOR-Y stage 3 (T1's change): 技能期间远程攻击不再降低攻击力
    const skillNoPen = chess.module?.active && num(chess.module.level) >= 3;
    const grid3 = s3?.rangeGrid ?? null;

    /** The enemies her notes may pick: those in the (current) range plus the ones she blocks. */
    const noteTargets = (battle, unit) => {
      const list = battle.enemiesInKeys(unit.rangeKeys || [], unit, AIR);
      for (const b of battle.blockedTargets(unit, unit.profile)) if (!list.includes(b)) list.push(b);
      sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
      return list;
    };

    /** A piano note pierces its target: the enemies on the tiles past it along her facing take the same damage. */
    const pierce = (battle, unit, target, amount) => {
      if (!(amount > 0) || !target) return;
      const [dr, dc] = dirVec(unit.dir);
      const tr = Math.round(target.y), tc = Math.round(target.x);
      for (let k = 1; k <= PIERCE_TILES; k++) {
        const r = tr + dr * k, c = tc + dc * k;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        for (const e of battle.enemiesInKeys([r * COLS + c], unit, AIR)) {
          if (e !== target && e.alive) battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill', 'oblvns:pierce'] });
        }
      }
    };

    return {
      skills: {
        // 新月的苏醒: one cast = 8 decaying arts notes ("充能至最大层数时自动释放一次" — the install's poller)
        [S1]: {
          kind: 'charges',
          onStart({ battle, unit }) {
            const list = noteTargets(battle, unit);
            for (let i = 0; i < 8; i++) {
              const alive = list.filter((e) => e.alive && e.side === 'enemy');
              if (!alive.length) break;
              const target = alive[i % alive.length];
              const scale = num(i === 0 ? bb.atk_scale : bb[`atk_scale_${i + 1}`]);
              battle.dealDamage(unit, target, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'oblvns:note'] });
            }
          },
        },
        // 满月的舞会: each cast switches the timbre and replaces the stance buff; the timbre's damage type and pierce
        // are the install's hooks
        [S2]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            unit.mem.oblvnsS2 = true;
            const next = (unit.mem.oblvnsMode ?? 'piano') === 'piano' ? 'organ' : 'piano';   // 钢琴（初始）
            unit.mem.oblvnsMode = next;
            const mods = next === 'piano' ? { atkPct: num(s2?.bb?.['attack@atk']) } : { aspd: num(s2?.bb?.['attack@attack_speed']) };
            battle.addBuff(unit, { key: 'oblvns:timbre', refresh: 'replace', mods, tags: ['skill'] });
          },
        },
        // 残月的余响: 25 s (data), the skill's own range, 2 + 2 tracking notes per attack; the Fever fatal-save of the
        // Ave Mujica members runs while it does (the T2 watcher retires the saved when the Fever ends)
        [S3]: {
          kind: 'duration',
          targeting: grid3 ? { rangeGrid: grid3 } : undefined,
          attack: skillNoPen ? { dmgMul: () => 1 } : undefined,
          onAttack({ battle, unit }) {
            const list = noteTargets(battle, unit).filter((e) => e.alive && e.side === 'enemy');
            if (!list.length) return;
            const amount = unit.s.atk * num(s3?.bb?.['attack@atk_scale'], 1.8);
            const byRes = list.slice().sort((a, b) => (b.s.res || 0) - (a.s.res || 0))[0];   // 法术抗性最高
            const byDef = list.slice().sort((a, b) => (b.s.def || 0) - (a.s.def || 0))[0];   // 防御力最高
            for (let i = 0; i < 2; i++) if (byRes.alive) battle.dealDamage(unit, byRes, { amount, type: 'phys', isSkill: true, tags: ['skill', 'oblvns:note'] });
            for (let i = 0; i < 2; i++) if (byDef.alive) battle.dealDamage(unit, byDef, { amount, type: 'arts', isSkill: true, tags: ['skill', 'oblvns:note'] });
          },
          onStart({ battle, unit }) {
            unit.mem.oblvnsFatal = battle.on('fatal', (c) => {
              if (c.prevented || !isMujica(c.unit) || !feverOf(battle, unit)) return;
              if (unit.skill?.id !== S3 || !unit.skill.active) return;
              c.prevented = true;
              c.unit.mem.oblvnsSaved = true;
            }, { owner: unit });
          },
          onEnd({ battle, unit }) {
            if (unit.mem.oblvnsFatal) { battle.off(unit.mem.oblvnsFatal); unit.mem.oblvnsFatal = null; }
          },
        },
      },
      talents: [
        { install(battle, unit) {   // 颂乐音符: her attacks play notes (≤ max_cnt), idle notes decay one per second
          const m = unit.mem;
          m.oblvnsNotes = 0;
          onHitBy(battle, unit, ({ dmg }) => {
            if (!dmg.isAttack) return;
            m.oblvnsNotes = Math.min(notesMax, (m.oblvnsNotes ?? 0) + 1);
            m.oblvnsAttackAt = battle.time;
          });
          battle.every(Math.max(NOTE_TICK, noteDelay), () => {   // one note per idle second (delay 1 s); an attack
            if (!up(unit) || !(m.oblvnsNotes > 0)) return;       // within the last second suppresses the tick
            if (battle.time - (m.oblvnsAttackAt ?? -Infinity) >= noteDelay - 1e-9) m.oblvnsNotes -= 1;
          }, { owner: unit });
          // per note, every Ave Mujica member ignores def/res (no range bound)
          if (defPen > 0 || resPen > 0) {
            installAura(battle, unit, {
              key: 'oblvns:notes', interval: NOTE_TICK,
              select: (a) => isMujica(a),
              mods: () => {
                const n = Math.min(notesMax, Math.max(0, unit.mem.oblvnsNotes ?? 0));
                return { defIgnorePct: defPen * n, resIgnorePct: resPen * n };
              },
            });
          }
        } },
        { install(battle, unit) {   // 毋畏遗忘: the Fever meter + the in-range ASPD aura
          const m = unit.mem;
          onHitBy(battle, unit, ({ target, dmg }) => {
            if (!target || target.side !== 'enemy' || !target.alive || !(dmg.amount > 0) || feverOf(battle, unit)) return;
            m.oblvnsFever = Math.min(FEVER_MAX, (m.oblvnsFever ?? 0) + feverCnt);
          });
          battle.every(NOTE_TICK, () => {   // the Fever state machine; at its end the S3-saved members retire
            const now = battle.time;
            const active = now < (m.oblvnsFeverUntil ?? -Infinity);
            if (!active && (m.oblvnsFever ?? 0) >= FEVER_MAX) {
              m.oblvnsFever = 0;
              m.oblvnsFeverUntil = now + FEVER_TIME;
            } else if (!active && m.oblvnsFeverOn) {
              for (const a of battle.allyUnits) {
                if (!a.mem?.oblvnsSaved) continue;
                a.mem.oblvnsSaved = false;
                battle.retreat(a, { reason: 'retreat' });   // [ASSUMED] the official 退场
              }
            }
            m.oblvnsFeverOn = active;
          }, { owner: unit });
          if (auraAspd > 0) {
            installAura(battle, unit, {
              key: 'oblvns:t2aura', interval: NOTE_TICK,
              select: (a) => a.kind === 'op' && !!unit.rangeKeySet?.has(a.tileR * COLS + a.tileC),
              mods: { aspd: auraAspd },
            });
          }
        } },
      ],
      install(battle, unit) {
        const m = unit.mem;
        // S1 "可充能2次，充能至最大层数时自动释放一次": cast as soon as both charges are held
        battle.every(NOTE_TICK, () => {
          const sk = unit.skill;
          if (!sk || sk.id !== S1 || !up(unit) || !unit.canAct || unit.s.flags.silence) return;
          if (sk.opCooling || sk.active || sk.charges < sk.maxCharges) return;
          sk.activate('charged');
        }, { owner: unit });
        // S2 timbre on her attacks: 风琴 notes deal arts; 钢琴 notes pierce once per attack
        battle.on('attack', (c) => { if (c.attacker === unit) m.oblvnsPierceDone = false; }, { owner: unit });
        onHitBy(battle, unit, ({ target, dmg }) => {
          if (!dmg.isAttack || !m.oblvnsS2) return;
          if (m.oblvnsMode === 'organ') dmg.type = 'arts';
          else if (m.oblvnsMode === 'piano' && !m.oblvnsPierceDone) {
            m.oblvnsPierceDone = true;
            pierce(battle, unit, target, dmg.amount);
          }
        });
        // Fever: the current timbre becomes a 二连击 (one extra attack, no ammo, guarded against recursion)
        battle.on('attack', (c) => {
          if (c.attacker !== unit || m.oblvnsExtra || !m.oblvnsS2 || !feverOf(battle, unit)) return;
          const seq = unit.deploySeq;
          battle.after(0, () => {
            if (!up(unit) || unit.deploySeq !== seq || !unit.canAct || m.oblvnsExtra || !feverOf(battle, unit)) return;
            m.oblvnsExtra = true;
            try { battle.forceAttack(unit, null, { noAmmo: true }); } finally { m.oblvnsExtra = false; }
          }, { owner: unit });
        }, { owner: unit });
      },
    };
  },
};
