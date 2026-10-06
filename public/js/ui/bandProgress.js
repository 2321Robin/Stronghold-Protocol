// Strategy / item progress for the cumulative counters (user playtest #16: "累计型策略加进度显示"). The server sends
// the raw key-value pairs on m.private.counters (PlayerState.progressCounters: `band:*` incl. the `:<key>:r` round
// stamps a lazy per-round counter leaves, and `pack:<piece uid>`); this module is the one place that turns them into
// display text, reading the thresholds from the data records (bands.json / items.json params). Consumers: the 本局信息
// tab's strategy block (enemyDrawer InfoTab), the effects strip's band entry (effectsList) and the 商业包装方案's card
// (detailPanel ItemDetail).

import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const int = (v, d) => (Number.isFinite(v) ? Math.trunc(v) : d);

/**
 * A band's progress from the player's own m.private.counters.
 * @param {string|null} bandId m.private.bandId (a scouted teammate's band has no counters of ours — pass null counters)
 * @param {Object|null} counters m.private.counters
 * @param {number|null} round m.public.round — tells the lazy per-round counters' round stamp from the current round
 * @returns {null|{lines:string[], badge:number|null, tip:string}} null when there is nothing to show (a band without
 *   cumulative counters, or no counters — e.g. before the draft or while scouting someone else's board)
 */
export function bandProgress(bandId, counters, round = null) {
  if (typeof bandId !== 'string' || !bandId || !counters) return null;
  const band = data.lookup('bands', bandId);
  const k = bandId.replace(/^band_/, '');
  if (!band || !k) return null;
  const p = band.params || {};
  // meta.js's counters are `band:<name>[:<what>]` with <name> = the bandId minus its `band_` prefix; the per-round
  // ones reset lazily on their first use of a round (roundCounter), so between rounds they still hold the last
  // round's value — the `band:<name>:r` stamp tells which round that was.
  const raw = (what = '') => { const v = counters[`band:${k}${what ? `:${what}` : ''}`]; return Number.isFinite(v) ? v : 0; };
  const stamp = () => { const v = counters[`band:${k}:r`]; return Number.isFinite(v) ? v : null; };

  if (bandId === 'band_paganini') {
    // 定制铳械: the first `coin_cnt` funds spent overall (one-shot; meta.js leaves the spent counter at its final value)
    const goal = Math.max(1, int(p.coin_cnt, 55));
    const done = raw('done') > 0;
    const shown = Math.min(Math.max(0, raw('spent')), goal);
    return { lines: [done ? t('累计花费 {shown}/{goal} · 已完成', { shown, goal }) : t('累计花费 {shown}/{goal}', { shown, goal })], badge: done ? null : shown, tip: done ? t('已完成') : t('累计花费 {shown}/{goal}', { shown, goal }) };
  }
  if (bandId === 'band_kirara') {
    // 通关奖励: every `coin_cnt` funds spent (repeatable); the counter carries the remainder toward the next one
    const goal = Math.max(1, int(p.coin_cnt, 20));
    const acc = Math.min(Math.max(0, raw('acc')), goal);
    return { lines: [t('距下次 {acc}/{goal}', { acc, goal })], badge: acc, tip: t('距下次 {acc}/{goal}', { acc, goal }) };
  }
  if (bandId === 'band_chiave') {
    // 团伙行动: every `refresh_count` manual refreshes (a match total) → 1 干员, at most `max_count` per round. The
    // per-round grant counter still holds the last round's value until this round's first refresh resets it.
    const every = Math.max(1, int(p.refresh_count, 6));
    const max = Math.max(1, int(p.max_count, 2));
    const total = Math.max(0, raw('refreshes'));
    const st = stamp();
    const got = Math.min(round != null && st === round ? Math.max(0, raw()) : 0, max);
    const toNext = total % every;
    return {
      lines: [t('距下次 {toNext}/{every}(累计刷新 {total})', { toNext, every, total }), t('本回合已得 {got}/{max}', { got, max })],
      badge: toNext,
      tip: t('距下次 {toNext}/{every} · 本回合已得 {got}/{max}', { toNext, every, got, max }),
    };
  }
  if (bandId === 'band_mlynar') {
    // 业务指标: every <卡西米尔> operator bought adds next round's +count funds, at most `max_count` per round. Before
    // this round's first such buy the counter still holds the last round's count — whose funds arrived at this round's
    // start (PlayerState.startRound pays pendingFunds) — so the line says so instead of a wrong 本回合 count.
    const max = Math.max(1, int(p.max_count, 3));
    const x = Math.min(Math.max(0, raw()), max);
    const st = stamp();
    if (round != null && Number.isFinite(st) && st < round) {
      const when = st === round - 1 ? t('上回合') : t('第 {st} 回合', { st });
      return { lines: [t('{when}已购 {x} 名 · 本回合 +{x} 已到账', { when, x })], badge: null, tip: t('本回合 +{x} 已到账', { x }) };
    }
    return { lines: [t('本回合已购 {x} 名 · 下回合 +{x}', { x })], badge: x || null, tip: t('本回合已购 {x}/{max}', { x, max }) };
  }
  return null;
}

/**
 * An equipment copy's own sold-counter progress — the 商业包装方案 (band_malkie's starting item): every `count`
 * operators the player sold grants 1 同盟约 operator of the carrier (builtinMeta onSold counts per item copy under
 * `pack:<uid>` and resets on each grant — a rolling counter).
 * @param {Object|null} item the item record (data.lookup('items', id))
 * @param {number|null} uid the piece uid of the player's own copy (a shop / reward card has none → null)
 * @param {Object|null} counters m.private.counters
 * @returns {null|{text:string, sold:number, goal:number}}
 */
export function packProgress(item, uid, counters) {
  if (!item || !Number.isFinite(uid) || !counters) return null;
  const buffs = Array.isArray(item.buffs) ? item.buffs : [];
  if (!buffs.some((b) => b && b.key === 'sell_char_count_gain_equip_owner_bond')) return null;
  const goal = Math.max(1, int(item.params && item.params.count, 8));
  const v = counters[`pack:${uid}`];
  const sold = Math.min(Number.isFinite(v) ? Math.max(0, v) : 0, goal);
  return { text: t('已售 {sold}/{goal}', { sold, goal }), sold, goal };
}
