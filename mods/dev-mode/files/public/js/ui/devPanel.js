// public/js/ui/devPanel.js — LOCAL DEV TOOL (playtest #24, never for upstream): the in-match developer-mode quick
// switches. The room's host turns the feature on per match (room.setExtras devMode, the 本局开发者模式 button next to
// 本局加地灵); this panel then floats over the match's left edge during the PREP phase. It owns no state and touches
// nothing optimistically — every button is just a g.dev request the server answers (match/match/dev.js DEV_ACTIONS),
// and the UI waits for the next m.private push like every other intent.
//
// Adding a switch = one row here + one row in the server's DEV_ACTIONS; the g.dev message and this panel never change.

import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';
import { actions } from './gameActions.js';
import { PHASE } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

// One row per server action: { label, action, v? } — v absent lets the server default apply (DEV_FUNDS_DEFAULT).
const DEV_BUTTONS = [
  { label: t('金币 999'), action: 'funds', v: 999 },
];

/**
 * The floating DEV tab + button panel (rendered from the match screen's hud). `hidden` = the screen is showing
 * somebody else's field (watchingOther): the switches act on the SENDER's own state, so they hide while watching.
 * Spectator / eliminated seats see nothing (no live m.private), and the panel exists only in PREP — funds and the
 * shop are prep-side state.
 */
export function DevPanel({ hidden = false }) {
  const on = useStore((s) => !!s.match.public?.extras?.devMode);
  const prep = useStore((s) => s.match.public?.phase === PHASE.PREP);
  const alive = useStore((s) => s.match.private?.alive === true);
  const [open, setOpen] = useState(false);
  if (hidden || !on || !prep || !alive) return null;
  return html`
    <div class="gm__dev">
      <button type="button" class="gm__dev-tab${open ? ' is-open' : ''}" aria-expanded=${open ? 'true' : 'false'}
        title=${t('开发者快捷开关（仅本局，房主在房间开启）')} onClick=${() => setOpen(!open)}>DEV</button>
      ${open ? html`
        <div class="gm__dev-panel">
          <div class="gm__dev-head">${t('开发者模式')}<span class="gm__dev-sub">${t('仅本局 · 不影响他人')}</span></div>
          ${DEV_BUTTONS.map((b) => html`
            <button type="button" key=${b.action} class="gm__dev-btn" onClick=${() => actions.dev(b.action, b.v)}>${b.label}</button>
          `)}
        </div>` : null}
    </div>`;
}
