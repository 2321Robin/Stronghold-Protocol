// The scouted player's hand (整备区) under a prep-watch board (游玩记录 #2 item 1:「观战队友时看不到队友的
// 未上场的干员」, suggested on GitHub #44 — "看不见队友的待战栏位"). The prep-scout m.field carries `bench`
// (Match.prepFieldMeta: uid / kind / id / tier / golden / equipped item ids; refreshed with the board by
// _prepScoutSig), read-only: thumbnails, a tap opens the record's detail card (the chess branch renders the
// equipped items; game.js builds the detail target).
import { html } from './components.js';
import { UnitThumb } from './gameComponents.js';

export function ScoutedBench({ bench, name, onPick }) {
  const rows = (Array.isArray(bench) ? bench : []).filter(Boolean);
  if (!rows.length) return null;
  return html`<div class="sbench" role="list" aria-label=${`${name || '队友'} 的整备区`}>
    <span class="sbench__label">${name || '队友'} 的整备区 <i class="num">${rows.length}</i></span>
    <div class="sbench__row">
      ${rows.map((p) => html`<button key=${p.uid} type="button" role="listitem" class="sbench__one"
        onClick=${() => onPick && onPick(p)}>
        <${UnitThumb} kind=${p.kind === 'item' ? 'item' : p.kind === 'token' ? 'token' : 'chess'} id=${p.id} golden=${p.golden} size="md" />
      </button>`)}
    </div>
  </div>`;
}
