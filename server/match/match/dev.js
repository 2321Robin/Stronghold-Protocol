// server/match/match/dev.js — LOCAL DEV TOOL (playtest #24, never for upstream): the in-match developer-mode quick
// switches. The room's host opts a match in before room.start (room.setExtras devMode); while on, every seated player
// may send g.dev { action, v? } — setOwnFunds-style shortcuts so a fix can be verified without playing a whole match
// (user request 2026-10-08: 「我想整个开发者版,即添加一个按钮比如金币999,这样就能方便测试改动效果」).
// Default off: without extras.devMode every g.dev fails (BAD_MSG) and the match behaves exactly like upstream.
//
// Adding a switch = one row in DEV_ACTIONS + one button row in public/js/ui/devPanel.js (the protocol's g.dev shape
// { action, v? } never changes). Actions run in the PREP phase only, on the sender's own PlayerState, and go through
// the same PlayerState mutators the game itself uses (addFunds …), so dirty() broadcast, stats and invariants apply.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { ERR, PHASE } from '../../../shared/constants.js';
import { OK, fail } from './common.js';

/** Default target of the funds action (the user's example: 一键金币 999 — enough to max the 调度中心 and roll freely). */
export const DEV_FUNDS_DEFAULT = 999;

/**
 * The allowlist of developer-mode actions (the client's button rows live in public/js/ui/devPanel.js DEV_BUTTONS —
 * its labels are the user-facing texts, so none are kept here). `apply` returns OK / fail; `v` is the
 * protocol-validated number (0 … 1e6) or undefined when the button sent none.
 */
export const DEV_ACTIONS = {
  funds: {
    // 一键金币：set the sender's funds to `v` (default DEV_FUNDS_DEFAULT) — enough to max the 调度中心 and roll freely
    apply(ps, v) {
      const target = Math.max(0, Math.trunc(Number.isFinite(v) ? v : DEV_FUNDS_DEFAULT));
      ps.addFunds(target - ps.funds, { reason: 'dev' });
      return OK;
    },
  },
};

export class MatchDev {
  /**
   * g.dev { action, v? }: run a developer-mode action for the sender. Gated on the room option (extras.devMode),
   * the PREP phase and a living seat — the same gates the shop intents use, so a switch can never fire mid-battle
   * or from the spectator seats (they hold no PlayerState anyway).
   */
  dev(ps, action, v) {
    if (!this.extras.devMode) return fail(ERR.BAD_MSG, 'dev mode is off');
    const act = DEV_ACTIONS[action];
    if (!act) return fail(ERR.BAD_MSG, `unknown dev action ${String(action).slice(0, 32)}`);
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    return act.apply(ps, v);
  }
}
