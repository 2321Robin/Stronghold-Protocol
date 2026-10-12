// server/sim/content/kits/ops/op-orchd2.js — 焰狐龙梓兰 (char_1048_orchd2) 自选 operator kit: 6★ 近距射程 (狙击),
// an owned-6★ pick of the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes
// the collab operators); every skill and the first talent at every form. Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1048_orchd2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) / 3 (tier 6). Potential 0 [ASSUMED: no account].
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 焰狐龙梓兰.
// - T0 强击瓶专家 "部署后首次开启技能时，接下来50次攻击的攻击力提升至120%": the first skillStart of a deployment
//   arms 50 powered attacks (bb power_attack_count × power_attack_scale); each attack instance spends one.
// - T1 翔虫机动 + the module's 再部署时间减少: the redeploy-time reduction (bb respawn_time −15, the module's −25) and
//   the same-position redeployment (+30 s of ATK / melee placement, bb atk / ignore_build_type_target) are match-side
//   redeployment economics the battle never sees [ASSUMED: not modelled — no server/match consumer of respawn_time;
//   the battle-side +15 % ATK window would key on the redeploy position the battle does not know either].
// - S1 刚射 (data 充能3, time SP cost 5, initSp 10): "充能至最大层数时自动释放一次" — the install casts it at full
//   charges (as 丰川祥子 S1). One cast = 4 arrows of atk_scale_1 (120 %); with a charge left it consumes one more and
//   fires the 强连射: 5 arrows of atk_scale_2 (160 %), each with a stun_prob (20 %) chance of stunning for bb.stun (2 s).
//   [ASSUMED] the arrows hit the first 4 / 5 targets of her standard order.
// - S2 飞翔瞪射 (data 充能3, duration 4.2, 技能范围 9 tiles, 部署后立即释放一次): the volley — three waves at 0 / 1.4 /
//   2.8 s hitting up to 3 / 4 / 5 targets of the skill range [ASSUMED the arrow counts cap the targets] with
//   attack@atk_scale_loop (150 %) each, then the landing blast: attack@atk_scale_end (270 %) physical to every enemy
//   around her tile (radius 1.5 [ASSUMED]) when the skill ends.
// - S3 龙之箭 (data 充能2, time SP): after the wait_duration (1.5 s 蓄力) a piercing arrow flies from her tile along her
//   facing over walls up to max_dist (99 — 射程无限): every enemy within ARROW_RADIUS [ASSUMED 1 tile, 周围] of each
//   passed tile takes atk_scale (300 %) physical + atk_scale_magic (40 %) arts and is pushed with force (中等力度).

import { num, talentBb, skillRec, enemiesInGrid, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';

const S1 = 'skchr_orchd2_1';
const S2 = 'skchr_orchd2_2';
const S3 = 'skchr_orchd2_3';

const ARROW_RADIUS = 1;     // [ASSUMED] the S3 arrow's 周围 radius (tiles, Chebyshev)
const S2_LAND_RADIUS = 1.5; // [ASSUMED] the S2 landing blast radius
const VOLLEY_IV = 1.4;      // the 4.2 s skill splits into three waves
const AIR = Object.freeze({ canHitFly: true });

export default {
  char_1048_orchd2: (bb, chess) => {
    const t0 = talentBb(chess, 0);            // 强击瓶专家: power_attack_count, power_attack_scale
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const grid2 = s2?.rangeGrid ?? null;

    return {
      trait: {
        // T0: the powered attacks (armed by the install's skillStart hook, spent per attack instance)
        dmgMul: (b, u, t) => (u.mem.orchdPower > 0 ? num(t0.power_attack_scale, 1.2) : 1),
      },
      skills: {
        // 刚射: 4 arrows, then the charged 强连射 (5 arrows, stun chance) while a charge remains; auto-released at full
        [S1]: {
          kind: 'charges',
          onStart({ battle, unit }) {
            const shoot = (n, scale, stun) => {
              const list = enemiesInGrid(battle, unit, null).filter((e) => e.alive);
              if (!list.length) return;
              for (let i = 0; i < n; i++) {
                const e = list[i % list.length];
                battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'orchd:arrow'] });
                if (stun && battle.rng.chance(num(bb.stun_prob, 0.2))) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 2), source: unit });
              }
            };
            shoot(4, num(bb.atk_scale_1, 1.2), false);
            if (unit.skill.charges >= 1) {
              unit.skill.charges--;
              shoot(5, num(bb.atk_scale_2, 1.6), true);
            }
          },
        },
        // 飞翔瞪射: three waves over the skill grid, then the landing blast around her tile — the deployment
        // release is the install's deploy hook (the data's initSp alone would not make it ready)
        [S2]: {
          kind: 'duration',
          targeting: grid2 ? { rangeGrid: grid2 } : undefined,
          onStart({ battle, unit, skill }) {
            const waves = [3, 4, 5];
            waves.forEach((n, i) => {
              battle.after(i * VOLLEY_IV, () => {
                if (!up(unit) || !unit.skill?.active) return;
                const list = battle.enemiesInKeys(unit.rangeKeys || [], unit, AIR).filter((e) => e.alive).slice(0, n);
                for (const e of list) {
                  battle.dealDamage(unit, e, { amount: unit.s.atk * num(s2?.bb?.['attack@atk_scale_loop'], 1.5), type: 'phys', isSkill: true, tags: ['skill', 'orchd:volley'] });
                }
              }, { owner: unit });
            });
          },
          onEnd({ battle, unit }) {
            if (!up(unit)) return;
            const scale = num(s2?.bb?.['attack@atk_scale_end'], 2.7);
            for (const e of battle.enemies) {
              if (!e.alive || e.side !== 'enemy') continue;
              if (Math.max(Math.abs(e.tileR - unit.tileR), Math.abs(e.tileC - unit.tileC)) <= S2_LAND_RADIUS) {
                battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'orchd:land'] });
              }
            }
          },
        },
        // 龙之箭: the charged piercing shot after the 蓄力 wait
        [S3]: {
          kind: 'charges',
          onStart({ battle, unit }) {
            battle.after(Math.max(0, num(bb.wait_duration, 1.5)), () => {
              if (!up(unit)) return;
              const [dr, dc] = dirVec(unit.dir);
              const maxDist = Math.min(99, num(bb.max_dist, 99));
              const phys = num(bb.atk_scale, 3), arts = num(bb.atk_scale_magic, 0.4);
              const hit = new Set();
              for (let k = 1; k <= maxDist; k++) {
                const r = unit.tileR + dr * k, c = unit.tileC + dc * k;
                for (const e of battle.enemies) {
                  if (!e.alive || e.side === 'ally' || hit.has(e.id)) continue;
                  if (Math.max(Math.abs(e.tileR - r), Math.abs(e.tileC - c)) <= ARROW_RADIUS) {
                    hit.add(e.id);
                    battle.dealDamage(unit, e, { amount: unit.s.atk * phys, type: 'phys', isSkill: true, tags: ['skill', 'orchd:dragon'] });
                    battle.dealDamage(unit, e, { amount: unit.s.atk * arts, type: 'arts', isSkill: true, tags: ['skill', 'orchd:dragon'] });
                    battle.push(e, num(bb.force, 1), { from: unit });
                  }
                }
              }
            }, { owner: unit });
          },
        },
      },
      talents: [
        { install(battle, unit) {   // 强击瓶专家: the first skillStart of a deployment arms 50 powered attacks
          const arm = () => {
            unit.mem.orchdArmed = true;
            unit.mem.orchdPower = Math.max(1, Math.floor(num(t0.power_attack_count, 50)));
          };
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            unit.mem.orchdArmed = false;
            unit.mem.orchdPower = 0;
            // S2 "部署后立即释放一次": the data's initSp is only 14/20 — the deployment release tops it up
            if (unit.skill?.id === S2) {
              unit.skill.gainSp(999);
              unit.skill.activate('deploy');
            }
          }, { owner: unit });
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || unit.mem.orchdArmed) return;
            arm();
          }, { owner: unit });
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || !(unit.mem.orchdPower > 0)) return;
            unit.mem.orchdPower--;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S1 "可充能3次，充能至最大层数时自动释放一次"
        battle.every(0.25, () => {
          const sk = unit.skill;
          if (!sk || sk.id !== S1 || !up(unit) || !unit.canAct || unit.s.flags.silence) return;
          if (sk.opCooling || sk.active || sk.charges < sk.maxCharges) return;
          sk.activate('charged');
        }, { owner: unit });
      },
    };
  },
};
