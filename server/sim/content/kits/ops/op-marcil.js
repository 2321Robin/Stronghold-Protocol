// server/sim/content/kits/ops/op-marcil.js — 玛露西尔 (char_4141_marcil) 自选 operator kit: 6★ 扩散术师 (术师), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots (the local SP_DIY_COLLAB build, playtest #21 — upstream excludes the
// collab operators); every skill and both talents at every form. Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4141_marcil, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) / 3 (tier 6). Potential 0 [ASSUMED: no account].
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 玛露西尔.
// - The mana pool: her skills run on 魔力 (the skill's SP bar, cap = its spCost); it does NOT regenerate naturally
//   (T0 "魔力不自然回复" — a permanent spRecoveryMul 0) and refills 1 per second while she is NOT on the field
//   (bb interval / mana_add, ticked by the install). Every skill opens through the install's poller with
//   activate({ free }) once the bar reaches the skill's skill_cost_min_sp, which then drains the cost itself
//   (the engine's ready gate needs the full bar — the official gate is the bb minimum).
// - T0 建校以来第一才女 "有魔力时，攻击力+25%，攻击溅射范围扩大": an ATK buff while her mana is above 0. The splash
//   radius growth has no engine mod [ASSUMED: not modelled]. T1 可靠的同伴 "初始魔力+25": her opening mana is the
//   selected skill's bb mana_init (the value the skill descriptions display; the T1 line reads as its source — the
//   kit grants exactly that at install). The 【莱欧斯小队】 team buff needs 4 such members — 玛露西尔 is the only one
//   the mode can field [ASSUMED: void].
// - S1 才女的实力 (toggle, per-attack drain): +85 % ATK while it runs; every attack consumes sp_cost (2) mana, and the
//   toggle ends when less than that remains; "在找不到攻击目标时改为治疗友方干员" — when no enemy is in her range her
//   attack becomes a heal on the most-wounded ally inside it; "可随时主动关闭" [ASSUMED: not modelled — no client
//   toggle]. The 1.5 s chant [ASSUMED: not modelled].
// - S2 召唤使魔 (a mode, 无限持续时间): each use consumes skill_cost_min_sp (35) mana and (after the 11 s chant
//   [ASSUMED: folded into the mode switch]) her attacks become the familiar's: ATK +70 %, every hit 停顿s its target
//   0.5 s; from the second use the familiar is upgraded — 攻击距离+1 (rangeExtend), ASPD +45 and the main target
//   晕眩 0.5 s per attack. The mode persists until she leaves; a recast (the bar back at 35) upgrades it.
// - S3 爆破魔法: each use consumes skill_cost_min_sp (8) mana; 5 s (chant_duration) later an explosion hits the area
//   around the tile in front of her for atk_scale (340 %) arts [ASSUMED radius 1.5]. "可追加吟唱10秒，完成后消耗剩余
//   所有魔力，每额外消耗8点魔力，追加1次爆炸" — the extra chant auto-completes 10 s later [ASSUMED: the cancellable
//   channel is not modelled]: floor(mana / sp_cost_extra) more explosions, bb interval (0.45) apart. The 高台碎片
//   晕眩 needs the wall interaction [ASSUMED: not modelled].
// - uniequip_002_marcil: +cost −8 / ATK / ASPD attributes only (the module's 部署费用减少 rides its attr).

import { num, talentBb, skillRec, enemiesInGrid, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { dirVec } from '../../../dir.js';

const S1 = 'skchr_marcil_1';
const S2 = 'skchr_marcil_2';
const S3 = 'skchr_marcil_3';

const BLAST_RADIUS = 1.5;   // [ASSUMED] the S3 explosion radius

export default {
  char_4141_marcil: (bb, chess) => {
    const t0 = talentBb(chess, 0);            // 才女: atk 0.25, the mana rules (interval, mana_add)
    const s1 = skillRec(chess, S1), s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);

    return {
      trait: {
        // the familiar's hit riders: 停顿 0.5 s on every hit, the upgraded one also stuns the main target
        afterHit(battle, u, target) {
          const lv = u.mem.marcilFamiliar ?? 0;
          if (!lv || !target || target.side !== 'enemy' || !target.alive) return;
          battle.applyStatus(target, 'sluggish', { duration: num(s2?.bb?.['attack@sluggish'], 0.5), source: u });
          if (lv >= 2) battle.applyStatus(target, 'stun', { duration: num(s2?.bb?.['attack@stun'], 0.5), source: u });
        },
      },
      skills: {
        // 才女的实力: the toggle drains 2 mana per attack; healing her allies when no enemy is in range
        [S1]: {
          kind: 'toggle',
          trigger: 'NEVER',
          mods: { atkPct: num(s1?.bb?.atk, 0.85) },
          onAttack({ battle, unit, skill }) {
            const cost = num(s1?.bb?.sp_cost, 2);
            skill.sp = Math.max(0, skill.sp - cost);
            if (skill.sp < cost) skill.stop();
          },
        },
        // 召唤使魔: each use consumes 35 mana and switches her attacks into the familiar's (upgrading from the second)
        [S2]: {
          kind: 'instant',
          trigger: 'NEVER',
          onStart({ battle, unit }) {
            const lv = (unit.mem.marcilFamiliar ?? 0) + 1;
            unit.mem.marcilFamiliar = lv;
            const mods = { atkPct: num(s2?.bb?.atk, 0.7) };
            if (lv >= 2) { mods.rangeExtend = 1; mods.aspd = num(s2?.bb?.attack_speed, 45); }
            battle.addBuff(unit, { key: 'marcil:familiar', refresh: 'replace', mods, tags: ['skill'] });
          },
        },
        // 爆破魔法: 5 s after the cast the explosion; the extra chant converts the rest of the mana 10 s later
        [S3]: {
          kind: 'instant',
          trigger: 'NEVER',
          onStart({ battle, unit, skill }) {
            const blast = () => {
              const [dr, dc] = dirVec(unit.dir);
              const r = unit.tileR + dr, c = unit.tileC + dc;
              for (const e of battle.enemies) {
                if (!e.alive || e.side !== 'enemy') continue;
                if (Math.hypot(e.x - (c + 0.5), e.y - (r + 0.5)) <= BLAST_RADIUS + 0.25) {
                  battle.dealDamage(unit, e, { amount: unit.s.atk * num(s3?.bb?.atk_scale, 3.4), type: 'arts', isSkill: true, tags: ['skill', 'marcil:blast'] });
                }
              }
            };
            battle.after(num(s3?.bb?.chant_duration, 5), () => {
              if (!up(unit)) return;
              blast();
              battle.after(num(s3?.bb?.extra_chant_duration, 10), () => {
                if (!up(unit)) return;
                const per = num(s3?.bb?.sp_cost_extra, 8), iv = num(s3?.bb?.interval, 0.45);
                const n = Math.floor(skill.sp / per);
                for (let i = 0; i < n; i++) battle.after(i * iv, () => { if (up(unit)) blast(); }, { owner: unit });
                skill.sp = 0;
              }, { owner: unit });
            }, { owner: unit });
          },
        },
      },
      talents: [
        { install(battle, unit) {   // the mana pool: no natural regen, +1/s off the field, the opening mana, the ATK buff
          const sk = unit.skill;
          battle.addBuff(unit, { key: 'marcil:mana', mods: { spRecoveryMul: 0 }, persist: true, allowDead: true, tags: ['talent'] });
          const init = num(sk && skillRec(chess, sk.id)?.bb?.mana_init, 0);
          if (init > 0 && sk) sk.sp = Math.min(sk.spCost, init);
          battle.every(num(t0.interval, 1), () => {
            if (up(unit) || !sk || sk.sp >= sk.spCost) return;
            sk.sp = Math.min(sk.spCost, sk.sp + num(t0.mana_add, 1));
          }, { owner: unit });
          const check = () => {
            const want = up(unit) && sk && sk.sp > 0;
            const has = unit.findBuff('talent:marcil:mana-atk');
            if (want && !has) battle.addBuff(unit, { key: 'talent:marcil:mana-atk', mods: { atkPct: num(t0.atk, 0.25) }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, 'talent:marcil:mana-atk');
          };
          battle.on('tick', check, { owner: unit });
          battle.on('battleStart', check, { owner: unit });
        } },
        { install(battle, unit) {   // the poller: every skill opens at its bb minimum, draining it from the mana
          battle.every(0.25, () => {
            if (!up(unit) || unit.s.flags.silence || !unit.canAct) return;
            const sk = unit.skill;
            if (!sk || sk.active || sk.noSkill || sk.opCooling) return;
            const min = num(skillRec(chess, sk.id)?.bb?.skill_cost_min_sp, sk.spCost);
            if (sk.sp < min) return;
            sk.activate('mana', { free: true });
            if (sk.id !== S1) sk.sp = Math.max(0, sk.sp - min);   // the toggle's cost is per-attack, not at opening
          }, { owner: unit, immediate: true });
        } },
        { install(battle, unit) {   // S1: when no enemy is in her range her attack becomes a heal on the most-wounded ally
          battle.every(1.3, () => {
            const sk = unit.skill;
            if (!up(unit) || !sk || sk.id !== S1 || !sk.active || !unit.canAct) return;
            if (enemiesInGrid(battle, unit, null).length) return;   // a real attack targets the enemies
            const keys = unit.rangeKeys || [];
            const allies = battle.allyUnits.filter((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed
              && keys.includes(a.tileR * COLS + a.tileC));
            const wounded = allies.sort((a, b) => a.hpRatio - b.hpRatio)[0];
            if (wounded) battle.heal(unit, wounded, unit.s.atk, { tags: ['skill', 'marcil:heal'] });
          }, { owner: unit });
        } },
      ],
    };
  },
};
