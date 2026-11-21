const shapes = {
  soundOn:'<path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  soundOff:'<path d="M3 9h4l5-4v14l-5-4H3z"/><path d="m16 9 5 6m0-6-5 6"/>',
  brand:'<path d="M3 9h18v11H3zM8 9V6h8v3M3 13h18M10 13v2h4v-2"/>',
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  rentals:'<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h5"/>',
  tools:'<path d="m3 7 9-4 9 4-9 5zM3 7v10l9 4 9-4V7M12 12v9"/>',
  clients:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  finance:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m5 6 12-3v3m4 5h-6v4h6"/>',
  reports:'<path d="M4 3v17h17M8 16v-5m5 5V7m5 9V4"/>',
  team:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/>',
  settings:'<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h5l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="11.5" cy="12" r="3"/>',
  exit:'<path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4"/>',menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
  close:'<path d="m6 6 12 12m0-12L6 18"/>',moon:'<path d="M20 15a8.5 8.5 0 0 1-11-11 9 9 0 1 0 11 11z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  check:'<path d="m5 12 4 4L19 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',wrench:'<path d="M14.5 5.5a6 6 0 0 0-7.2 7.4L3 17.2 6.8 21l4.4-4.4a6 6 0 0 0 7.4-7.3l-3.4 3.3-3.3-3.3z"/>'
};
export function icon(name) {
  return `<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shapes[name] || ''}</svg>`;
}
export function mountIcons(root = document) {
  root.querySelectorAll('[data-symbol]').forEach(el => { el.innerHTML = icon(el.dataset.symbol); });
}

