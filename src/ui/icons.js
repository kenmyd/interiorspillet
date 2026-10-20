/**
 * Inline SVG icons (24×24, stroke = currentColor) and the game logo. Drawn for this project – no icon font,
 * no external assets. Use with dom.svg(ICONS.name) or as innerHTML.
 */

const S = (body, extra = '') =>
  `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICONS = {
  play: `<svg class="kv-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.2v13.6a1 1 0 0 0 1.52.85l10.9-6.8a1 1 0 0 0 0-1.7L9.52 4.35A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg>`,
  sliders: S('<path d="M4 6.5h8M16 6.5h4M4 12h3M11 12h9M4 17.5h10M18 17.5h2"/><circle cx="14" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="17.5" r="2"/>'),
  keyboard: S('<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6 10h.01M9.3 10h.01M12.6 10h.01M15.9 10h.01M6 13.6h.01M18 10h.01M18 13.6h.01M8.5 14h7"/>'),
  lock: S('<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/><path d="M12 14.5v2.2"/>'),
  rotate: S('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5v4.2h-4.2"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: S('<path d="M15 5l-7 7 7 7"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  exit: S('<path d="M14 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h7"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>'),
  reset: S('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4.2h4.2"/>'),
  mouse: S('<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 3v6.5M6.5 9.5h11"/>'),
  monitor: S('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16v4"/>'),
  volume: S('<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>'),
  warning: S('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4h.01"/>'),
  bulb: S('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>'),
  pin: S('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'),
  user: S('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  pause: S('<path d="M9 5.5v13M15 5.5v13"/>'),
  home: S('<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  sofa: S('<path d="M5 11V8.5A2.5 2.5 0 0 1 7.5 6h9A2.5 2.5 0 0 1 19 8.5V11"/><path d="M3 13.5a2 2 0 0 1 4 0V15h10v-1.5a2 2 0 0 1 4 0V18H3z"/><path d="M5 18v2M19 18v2"/>'),
  lamp: S('<path d="M8 3.5h8l3 7H5z"/><path d="M12 10.5V20M8 20.5h8"/>'),
  blinds: S('<rect x="4" y="3.5" width="16" height="17" rx="1.5"/><path d="M4 7.5h16M4 11h16M4 14.5h16M15.5 3.5v13"/>'),
  // vitrineskap: two glass doors, shelves behind, short legs
  cabinet: S('<rect x="5.5" y="2.5" width="13" height="17" rx="1.2"/><path d="M12 2.5v17M5.5 8.2h13M5.5 13.8h13M7.5 19.5v2M16.5 19.5v2M7.7 4.4l1.6 1.6M14 4.4l1.6 1.6"/>'),
  palette: S('<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.3-1.6-1.3-2.8 0-1 .8-1.6 1.8-1.6h2.2a4 4 0 0 0 4-4C20.5 6.6 16.7 3.5 12 3.5z"/><circle cx="7.8" cy="11.5" r="1"/><circle cx="10.5" cy="7.6" r="1"/><circle cx="15" cy="7.8" r="1"/>'),
};

let logoId = 0;

/**
 * The game logo: a house outline with an armchair inside, in the amber accent gradient.
 * @param {number} [size=48] css pixels (the svg scales with font-size when styled in em)
 */
export function logoSvg(size = 48) {
  const id = `kvlogo${++logoId}`;
  return `<svg class="kv-logo" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd877"/><stop offset="1" stop-color="#ff9b1a"/>
    </linearGradient>
    <radialGradient id="${id}r" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0" stop-color="#2a3a48"/><stop offset="1" stop-color="#121b24"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="29" fill="url(#${id}r)"/>
  <circle cx="32" cy="32" r="28" fill="none" stroke="url(#${id}g)" stroke-width="3"/>
  <path d="M15.5 31.5 32 17.5l16.5 14V47a2 2 0 0 1-2 2h-29a2 2 0 0 1-2-2z" fill="none" stroke="#7fb6e0" stroke-opacity="0.6" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M23.5 44.5v-5.2a3.3 3.3 0 0 1 3.3-3.3h10.4a3.3 3.3 0 0 1 3.3 3.3v5.2" fill="none" stroke="url(#${id}g)" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M21 44.5h22M24.5 48v-3.5M39.5 48v-3.5M26.5 36v-3a2.5 2.5 0 0 1 2.5-2.5h6a2.5 2.5 0 0 1 2.5 2.5v3" fill="none" stroke="url(#${id}g)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}
