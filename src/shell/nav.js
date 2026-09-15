/**
 * The apps rail, as data. One list feeds every screen that mounts the shell,
 * so adding an app is one entry here instead of an edit to every page.
 *
 * Pure on purpose: no DOM at import time, so tests/shell-nav.test.mjs can load
 * it under node. Hrefs are relative to src/pages/, where every app page lives.
 */

const ICONS = {
  hub: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/>',
  floor: '<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M3 8h14"/><path d="M8 8v9"/>',
  scoreboard: '<path d="M4 16V10"/><path d="M8 16V7"/><path d="M12 16V4"/><path d="M16 16V9"/>',
  scale: '<path d="M10 3v14"/><path d="M4 6h12"/><path d="M3 11l1-5h4l1 5"/><path d="M11 11l1-5h4l1 5"/>',
  sack: '<path d="M4 8h12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"/><path d="M6 8V5a4 4 0 0 1 8 0v3"/>',
  analytics: '<path d="M3 17V3"/><path d="M3 17h14"/><path d="M6 13l3-4 3 2 4-5"/>',
  wholesale: '<path d="M3 6h14v11H3z"/><path d="M3 9h14"/><path d="M8 13h5"/>',
  consignment: '<path d="M2 10h4l3-3 2 2 3-3h4"/><path d="M7 13l2 2 4-4"/>',
  board: '<rect x="2" y="3" width="4.5" height="14" rx="1"/><rect x="7.75" y="3" width="4.5" height="14" rx="1"/><rect x="13.5" y="3" width="4.5" height="14" rx="1"/>',
  panel: '<rect x="3" y="4" width="14" height="12" rx="1"/><path d="M7 4v12"/>',
  sop: '<rect x="4" y="3" width="12" height="15" rx="2"/><path d="M7 2.5h6"/><path d="M7 9l2 2 4-4"/>',
  complaints: '<path d="M10 2L2 18h16L10 2z"/><path d="M10 8v4"/><circle cx="10" cy="14.5" r="0.5" fill="currentColor"/>',
};

export const NAV = [
  {
    id: 'floor',
    group: 'Floor',
    items: [
      { id: 'hub', label: 'Hub', href: 'index.html', icon: 'hub' },
      { id: 'floor-manager', label: 'Floor Manager', href: 'hourly-entry.html', icon: 'floor' },
      { id: 'scoreboard', label: 'Scoreboard', href: 'scoreboard-v2.html', icon: 'scoreboard' },
      { id: 'scale-display', label: 'Scale Display', href: 'scale-display.html', icon: 'scale' },
      { id: 'supersack-tracker', label: 'Supersack Tracker', href: 'supersack-entry.html', icon: 'sack' },
      { id: 'supersack-analytics', label: 'Supersack Analytics', href: 'supersack-analytics.html', icon: 'analytics' },
    ],
  },
  {
    id: 'office',
    group: 'Office',
    items: [
      { id: 'wholesale', label: 'Wholesale', href: 'wholesale.html', icon: 'wholesale' },
      { id: 'consignment', label: 'Consignment', href: 'consignment.html', icon: 'consignment' },
      // The crew still works from the original Kanban page; Tag Desk replaces it
      // only once it has earned that in real use (Koa, 2026-09-15).
      { id: 'supply-kanban', label: 'Supply Kanban', href: 'kanban.html', icon: 'board' },
      { id: 'tag-desk', label: 'Tag Desk (beta)', href: 'tag-desk.html', icon: 'panel' },
      { id: 'sop-manager', label: 'SOP Manager', href: 'sop-manager.html', icon: 'sop' },
      { id: 'complaints', label: 'Complaints', href: 'complaints.html', icon: 'complaints' },
    ],
  },
];

/** The nav entry for a URL path, or null when the page is not in the rail. */
export function currentApp(pathname) {
  const file = String(pathname || '').split('/').pop() || 'index.html';
  for (const group of NAV) {
    const hit = group.items.find((item) => item.href === file);
    if (hit) return hit;
  }
  return null;
}

const svg = (name) =>
  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

/**
 * Inner HTML of the rail: brand, one nav group per NAV entry, and the status
 * foot. With `i18n`, group and app names carry data-i18n keys from labels.js so
 * the shared i18n module can swap their language.
 */
export function railHtml(currentId, { brand = 'Ops Hub', logo = '../assets/ro-logo-horizontal.png', i18n = false } = {}) {
  const key = (k) => (i18n ? ` data-i18n="${k}"` : '');
  const groups = NAV.map((group) => {
    const links = group.items
      .map((item) => {
        const current = item.id === currentId ? ' aria-current="page"' : '';
        return `<a href="${item.href}"${current}>${svg(item.icon)}<span${key(`shell.nav.${item.id}`)}>${item.label}</span></a>`;
      })
      .join('');
    return `<nav class="rail-group" aria-label="${group.group}"><div class="eyebrow"${key(`shell.group.${group.id}`)}>${group.group}</div>${links}</nav>`;
  }).join('');

  return `<div class="rail-brand"><img src="${logo}" alt="" width="36" height="36"><div><strong>Rogue Origin</strong><span>${brand}</span></div></div>`
    + groups
    + '<div class="rail-foot"><span class="pulse"><span class="pulse-dot idle" id="railDot"></span><span id="railText">Connecting…</span></span></div>';
}
