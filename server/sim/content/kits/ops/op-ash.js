// server/sim/content/kits/ops/op-ash.js — 灰烬 (char_456_ash) 自选 operator kit: 6★ 快速神射手 (狙击), an owned-6★
// pick of the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes the collab
// operators); every skill, both talents and both modules (MAR-Y, MAR-X) at every form. Kit contract and the 自选 rules:
// ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_456_ash, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Potential 0 [ASSUMED: no account].
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 灰烬 (T1/S2/S3
// 备注, 闪光弹范围).
// - Trait (快速神射手) "优先攻击空中单位": the fastshot profile (professions.js: priority fly; MAR-X's trait bb
//   atk_scale 1.1 rides profile.flyScale — ×1.1 vs flying, ×1 vs ground), hits air, range 3-10, blocks 2.
// - T0 辅助装备 "部署后立即对攻击范围内一个敌人投掷闪光弹，使其和周围敌人晕眩4秒": on every deployment, the first
//   target of her standard order is the flash point; it and every enemy within FLASH_RADIUS [ASSUMED 1.5, Chebyshev
//   ≤ 1 — no blackboard key] are stunned for bb.stun. S2's "立即触发第一天赋" fires the same flashbang.
// - T1 突击手 "首次部署时部署费用-3，部署后立即获得20（+3）技力": the −3 deployment cost is a prep-side data field
//   the battle never applies (as SOL-Y's −4, op-siege.test.js); the +20 SP applies on every deployment [ASSUMED:
//   no first-deploy-only flag in the data]; the (+3) has no data key and is not modelled.
// - S1 支援射击 (MANUAL, time SP, 持续时间无限): a toggle — ATK +atk, every attack hits attack@times ×2.
// - S2 突击战术 (MANUAL, time SP): ammo — S2_AMMO rounds [ASSUMED 31 from the text, no blackboard key]; onStart
//   triggers T0; while it runs the attack interval shrinks by base_attack_time (bb −0.8 s ⇒ batPct −0.8 [ASSUMED:
//   her base interval is 1.0 s, the flat and the percentage agree]) and an attack on a stunned target deals
//   ash_s_2[atk_scale].atk_scale (210 %) instead of its plain damage.
// - S3 攻坚榴弹 (MANUAL, time SP, 技能范围 5 tiles ahead, data SKILL_RANGE): the shell marches from her tile along her
//   facing up to the grid's reach [ASSUMED: no travel time], deals atk_scale (260 %) physical to every enemy on the
//   passed tiles and pushes each with force (较大力度); the first wall / high-ground tile stops it (从低地撞到高台),
//   and it explodes there for hitwall_scale (720 %) — otherwise at the end of the path for not_hitwall_scale (360 %)
//   — hitting every enemy within range_radius + the 0.25 collider. "每次部署只能释放2次": the third cast is blocked
//   (skill.noSkill) until the next deployment.
// - MAR-Y (uniequip_002_ash, stage 3 talent change index −1): "范围内存在地面敌人时攻击速度+8" — an ASPD buff while a
//   ground enemy is in her range. MAR-X (uniequip_003_ash): the trait's air scale (above), nothing to code.

import { num, talentBb, skillRec, enemiesInGrid, toggleBuff, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';

const S1 = 'skchr_ash_1';
const S2 = 'skchr_ash_2';
const S3 = 'skchr_ash_3';

const FLASH_RADIUS = 1.5;  // [ASSUMED] the flashbang's radius — no blackboard key (Chebyshev ≤ 1 around the flash point)
const S2_AMMO = 31;        // [ASSUMED] the text's 31 rounds — no blackboard key

export default {
  char_456_ash: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const grid3 = s3?.rangeGrid ?? null;
    const marY = (chess.talents || []).find((t) => t.index === -1);   // the MAR-Y module's pseudo-talent
    const reach3 = grid3 ? Math.max(1, ...grid3.map(([r, c]) => Math.max(Math.abs(r), Math.abs(c)))) : 5;

    /** T0 辅助装备: the flashbang — the first target of her order is the flash point (it + its neighbours are stunned). */
    const flashbang = (battle, unit) => {
      const list = enemiesInGrid(battle, unit, null).filter((e) => e.alive);
      const point = list[0];
      if (!point) return false;
      const dur = num(t0.stun, 4);
      for (const e of list) {
        if (Math.max(Math.abs(e.tileR - point.tileR), Math.abs(e.tileC - point.tileC)) <= FLASH_RADIUS) {
          battle.applyStatus(e, 'stun', { duration: dur, source: unit });
        }
      }
      return true;
    };

    /** S3 攻坚榴弹: the shell — line damage + push, then the explosion (720 % on a wall, else 360 % at path's end). */
    const shell = (battle, unit) => {
      const [dr, dc] = dirVec(unit.dir);
      const path = [];
      let hitWall = false;
      for (let k = 1; k <= reach3; k++) {
        const r = unit.tileR + dr * k, c = unit.tileC + dc * k;
        if (!battle.grid.inRect(r, c) || !battle.grid.isLow(r, c)) { hitWall = true; path.push([r, c]); break; }
        path.push([r, c]);
      }
      const scale = num(bb.atk_scale, 2.6);
      for (const [r, c] of path) {
        for (const e of battle.enemiesInKeys([r * COLS + c], unit, { canHitFly: true })) {
          if (!e.alive) continue;
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'ash:shell'] });
          battle.push(e, num(bb.force, 2), { from: unit });
        }
      }
      const [er, ec] = path[path.length - 1] ?? [unit.tileR, unit.tileC];
      const blast = unit.s.atk * num(hitWall ? bb.hitwall_scale : bb.not_hitwall_scale, hitWall ? 7.2 : 3.6);
      const radius = num(bb.range_radius, 1.5);
      for (const e of battle.enemies) {
        if (!e.alive || e.side !== 'enemy') continue;
        if (Math.hypot(e.x - (ec + 0.5), e.y - (er + 0.5)) <= radius + 0.25) {
          battle.dealDamage(unit, e, { amount: blast, type: 'phys', isSkill: true, tags: ['skill', 'ash:blast'] });
        }
      }
      return true;
    };

    return {
      skills: {
        // 支援射击: 持续时间无限 ⇒ toggle
        [S1]: {
          kind: 'toggle',
          mods: { atkPct: num(bb.atk) },
          attack: { hits: Math.max(1, Math.round(num(bb['attack@times'], 1))) },
        },
        // 突击战术: 31 rounds, the flashbang on cast, the shortened interval and the ×2.1 vs stunned while it runs
        [S2]: {
          kind: 'ammo',
          ammo: S2_AMMO,
          mods: { batPct: num(s2?.bb?.base_attack_time, -0.8) },
          attack: { dmgMul: (b, u, t) => (t && t.alive && t.s.flags.stun ? num(s2?.bb?.['ash_s_2[atk_scale].atk_scale'], 2.1) : 1) },
          onStart({ battle, unit }) { flashbang(battle, unit); },
        },
        // 攻坚榴弹: the shell, twice per deployment (the cap is the install's counter)
        [S3]: {
          kind: 'instant',
          targeting: grid3 ? { rangeGrid: grid3 } : undefined,
          onStart({ battle, unit }) { shell(battle, unit); },
        },
      },
      talents: [
        { install(battle, unit) {   // 辅助装备: the flashbang on every deployment
          battle.on('deploy', (c) => {
            if (c.unit !== unit || !up(unit)) return;
            flashbang(battle, unit);
            unit.mem.ashUses = 0;                       // the S3 counter restarts with the deployment
            if (unit.skill && unit.skill.noSkill) unit.skill.noSkill = false;
            const sp = num(talentBb(chess, 1).sp, 20);  // 突击手: +20 技力 on deployment
            if (sp > 0 && unit.skill && !unit.skill.noSkill) unit.skill.gainSp(sp);
          }, { owner: unit });
        } },
        { install(battle, unit) {   // MAR-Y (the module's pseudo-talent): ASPD +attack_speed while a ground enemy is in range
          if (!marY) return;
          const aspd = num(marY.bb && marY.bb.attack_speed);
          if (!(aspd > 0)) return;
          toggleBuff(battle, unit, 'mod:ash:mar-y', () => enemiesInGrid(battle, unit, null).some((e) => !e.isFlying), { aspd });
        } },
      ],
      install(battle, unit) {
        // S3 "每次部署只能释放2次": the third cast is blocked until the next deployment
        if (unit.skill?.id === S3) {
          unit.mem.ashUses = 0;
          const onStart = unit.skill.spec.onStart;
          unit.skill.spec.onStart = (ctx) => {
            onStart(ctx);
            unit.mem.ashUses = num(unit.mem.ashUses) + 1;
            if (unit.mem.ashUses >= 2) unit.skill.noSkill = true;
          };
        }
      },
    };
  },
};
