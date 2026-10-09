// server/sim/content/kits/ops/op-yato2.js — 麒麟R夜刀 (char_1029_yato2) 自选 operator kit: 6★ 处决者 (特种), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes
// the collab operators); every skill, both talents and both modules (ECO, FEAT-type trait parts) at every form. Kit
// contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1029_yato2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Potential 0 [ASSUMED: no account].
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 麒麟R夜刀
// (S1 备注 三连击计数, S2 备注, S3 备注, 模组 ECO-X 撤退返还).
// - Trait (处决者) "再部署时间大幅度减少": the archetype's fast redeploy rides her form stats (respawnTime) — nothing
//   to code. ECO-X's trait part (withdraw_cost_recover_ratio 0.8, 撤退时返还大量部署费用) is a match-side refund the
//   battle never sees [ASSUMED: not modelled, as SOL-Y's cost −4].
// - T0 双雷剑麒麟 "攻击额外造成攻击力20%的法术伤害": the trait's afterHit — one arts instance of ATK ×
//   attack@atk_scale_1 after every attack hit (as 棘刺's LOR-X addition). S2's window multiplies it by its
//   talent_scale (2.73; the desc displays the rounded 2.1 — the blackboard is authoritative).
// - T1 鬼人强化状态 "技能期间及技能结束后的10秒内攻击力+16%": an ATK buff while a skill runs and for bb.duration
//   (10 s) after it ends (each spec's onEnd stamps the window; instants end right after their cast).
// - S1 鬼人化 (落地, data ON_DEPLOY ⇒ activateOnDeploy; 20 s, bb attack_speed): ASPD +70 and every attack is a 2-hit
//   (二连击 — no blackboard key, the text); "对同一目标的第三次攻击变为六连击" — every third attack a target takes
//   deals four extra full-ATK instances on top of its 2 [ASSUMED: net 6, the extras ride no rider and give no SP —
//   the spec's hitsFn cannot see the target].
// - S2 乱舞 (落地 instant): "第一天赋效果提升至2.1倍，攻击力提升至130%并对前方一格的所有敌人发动16次斩击，期间
//   更容易受到敌人的攻击" — a 2.5 s window [ASSUMED: no duration key] with ATK +30 % (atkPct = atk_scale − 1) and
//   taunt +1, sixteen slashes every 0.125 s [ASSUMED] on the enemies of the front tile, each a plain-ATK physical
//   instance (the window's +30 % rides it) plus the T0 rider at ×talent_scale.
// - S3 空中回旋乱舞 (落地 instant): "向前突进2格，每突进一段距离都会对周围所有敌人发动攻击力260%的斩击；期间每攻击
//   到一个敌人都会使突进距离延长（最多延长至5格，可以攻击空中单位）" — she dashes tile by tile (battle.moveRedeploy,
//   as 明霄陈's 移动): min_dist (2) tiles, +1 tile per 3 enemies the dashes caught [ASSUMED: dist_unit 0.3 per hit],
//   at most max_dist (5); every step deals atk_scale (260 %) physical to every enemy around it (radius 1.5 [ASSUMED],
//   flyers included). The first talent's rider applies to the dashes' hits.
// - uniequip_003_yato2's trait part (周围四格没有友方干员时攻击力+10%): an ATK buff while none of her four orthogonal
//   neighbours is a friendly operator (as 判官's UNY-Y, at four tiles).

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';

const S1 = 'skchr_yato2_1';
const S2 = 'skchr_yato2_2';
const S3 = 'skchr_yato2_3';

const SLASH_IV = 0.125;    // [ASSUMED] the S2 slash interval — no blackboard key
const S2_WINDOW = 2.5;     // [ASSUMED] the S2 window (16 slashes × 0.125 s)
const DASH_RADIUS = 1.5;   // [ASSUMED] the S3 step's 周围 radius
const AIR = Object.freeze({ canHitFly: true });

export default {
  char_1029_yato2: (bb, chess) => {
    const t0 = talentBb(chess, 0);            // 双雷剑麒麟: attack@atk_scale_1
    const t1 = talentBb(chess, 1);            // 鬼人强化状态: atk, duration
    const s2 = skillRec(chess, S2);
    const tb = traitBb(chess);
    const modAlone = num(tb.atk);             // uniequip_003's trait part: 周围四格没有友方干员时攻击力+10%

    return {
      trait: {
        // T0 双雷剑麒麟: every attack hit adds one arts instance (×talent_scale inside the S2 window)
        afterHit(battle, u, target) {
          if (!target || target.side !== 'enemy' || !target.alive) return;
          const scale = num(t0['attack@atk_scale_1'], 0.2) * (battle.time < (u.mem.yato2S2Until ?? -Infinity) ? num(s2?.bb?.talent_scale, 2.73) : 1);
          if (!(scale > 0)) return;
          battle.dealDamage(u, target, { amount: u.s.atk * scale, type: 'arts', tags: ['talent', 'yato2:rider'] });
        },
      },
      skills: {
        // 鬼人化: 20 s on deployment — ASPD +70, every attack a 2-hit; the third attack on a target nets six (the install)
        [S1]: {
          kind: 'duration',
          activateOnDeploy: true,
          mods: { aspd: num(bb.attack_speed, 70) },
          attack: { hits: 2 },
          onEnd({ battle, unit }) { unit.mem.yato2SkillUntil = battle.time + num(t1.duration, 10); },
        },
        // 乱舞: on deployment — the T1 rider window ×talent_scale, +30 % ATK + taunt, 16 slashes on the front tile
        [S2]: {
          kind: 'instant',
          activateOnDeploy: true,
          onStart({ battle, unit }) {
            const [dr, dc] = dirVec(unit.dir);
            const front = () => battle.enemiesInKeys([(unit.tileR + dr) * COLS + (unit.tileC + dc)], unit, AIR).filter((e) => e.alive);
            unit.mem.yato2S2Until = battle.time + S2_WINDOW;
            battle.addBuff(unit, { key: 'yato2:s2', duration: S2_WINDOW, mods: { atkPct: num(s2?.bb?.atk_scale, 1.3) - 1, taunt: num(s2?.bb?.taunt_level, 1) }, tags: ['skill'] });
            for (let i = 0; i < 16; i++) {
              battle.after(i * SLASH_IV, () => {
                if (!up(unit)) return;
                for (const e of front()) {
                  battle.dealDamage(unit, e, { amount: unit.s.atk, type: 'phys', isSkill: true, tags: ['skill', 'yato2:slash'] });
                }
              }, { owner: unit });
            }
            unit.mem.yato2SkillUntil = battle.time + S2_WINDOW + num(t1.duration, 10);
          },
        },
        // 空中回旋乱舞: on deployment — the dash, 260 % per step, extending on the enemies it caught
        [S3]: {
          kind: 'instant',
          activateOnDeploy: true,
          onStart({ battle, unit }) {
            const [dr, dc] = dirVec(unit.dir);
            const minDist = Math.max(1, Math.floor(num(bb.min_dist, 2)));
            const maxDist = Math.max(minDist, num(bb.max_dist, 5));
            const scale = num(bb.atk_scale, 2.6);
            let caught = 0;
            let r = unit.tileR, c = unit.tileC;
            for (let k = 1; k <= maxDist; k++) {
              const nr = r + dr, nc = c + dc;
              if (!battle.grid.inRect(nr, nc) || !battle.grid.isLow(nr, nc)) break;   // walls stop the dash
              r = nr; c = nc;
              let hits = 0;
              for (const e of battle.enemies) {
                if (!e.alive || e.side !== 'enemy') continue;
                if (Math.max(Math.abs(e.tileR - r), Math.abs(e.tileC - c)) <= DASH_RADIUS) {
                  hits++;
                  battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'yato2:wind'] });
                }
              }
              caught += hits;
              if (battle.enemies.some((e) => e.alive && e.side === 'enemy' && e.tileR === r && e.tileC === c)) break;   // she stops on the enemy she caught
              battle.moveRedeploy(unit, r, c);
              if (k >= minDist && (caught === 0 || k * 3 > caught)) break;   // +1 tile per 3 caught [ASSUMED dist_unit 0.3]
            }
            unit.mem.yato2SkillUntil = battle.time + num(t1.duration, 10);
          },
        },
      },
      talents: [
        { install(battle, unit) {   // 鬼人强化状态: ATK +atk while a skill runs and duration s after it ends
          const apply = () => {
            const want = up(unit) && (unit.skill?.active || battle.time < (unit.mem.yato2SkillUntil ?? -Infinity));
            const has = unit.findBuff('talent:yato2:ogre');
            if (want && !has) battle.addBuff(unit, { key: 'talent:yato2:ogre', mods: { atkPct: num(t1.atk, 0.16) }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, 'talent:yato2:ogre');
          };
          battle.on('tick', apply, { owner: unit });
          battle.on('battleStart', apply, { owner: unit });
        } },
        { install(battle, unit) {   // uniequip_003's trait part: 周围四格没有友方干员时攻击力+10%
          if (!(modAlone > 0)) return;
          const alone = () => !battle.allyUnits.some((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed
            && Math.abs(a.tileR - unit.tileR) + Math.abs(a.tileC - unit.tileC) === 1);
          const check = () => {
            const want = up(unit) && alone();
            const has = unit.findBuff('mod:yato2:alone');
            if (want && !has) battle.addBuff(unit, { key: 'mod:yato2:alone', mods: { atkPct: modAlone }, tags: ['module'] });
            else if (!want && has) battle.removeBuff(unit, 'mod:yato2:alone');
          };
          battle.on('tick', check, { owner: unit });
          battle.on('battleStart', check, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) check(); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S1 "对同一目标的第三次攻击变为六连击": the 2-hit attack plus four extra full-ATK instances on every third
        // attack a target takes (counted per attack, not per hit)
        if (unit.skill?.id === S1) {
          unit.mem.yatoCombo = {};
          battle.on('damaged', (c) => {
            if (c.source !== unit || !c.dmg?.isAttack || !c.target || c.target.side !== 'enemy') return;
            const id = `${c.target.id}:${c.dmg.attackId}`;
            if (unit.mem.yatoCombo[id]) return;
            unit.mem.yatoCombo[id] = true;
            const tgt = c.target.id;
            unit.mem.yatoCombo['n' + tgt] = num(unit.mem.yatoCombo['n' + tgt]) + 1;
            if (unit.mem.yatoCombo['n' + tgt] % 3 === 0) {
              for (let i = 0; i < 4; i++) {
                battle.dealDamage(unit, c.target, { amount: unit.s.atk, type: 'phys', isSkill: true, tags: ['skill', 'yato2:combo'] });
              }
            }
          }, { owner: unit });
        }
      },
    };
  },
};
