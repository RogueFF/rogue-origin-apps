/**
 * What the trim floor actually produced, per strain, on a given day.
 *
 * Nobody weighs a supersack's output on its own. The floor records finished
 * pounds hour by hour with the strain being run, so the day's total per strain
 * is the real measurement — and a bag's share is that total divided among the
 * bags of that strain opened the same day.
 *
 * The hourly rows carry `strain` in Shopify variant-title form
 * ("2025 - Sugar Cookez (Cookies) / Sungrown"), which is the same key the
 * Super Sack Inventory uses, so floor output joins to a cultivar without a
 * separate mapping.
 *
 * This reads the production scoreboard rather than the hourly table directly:
 * the scoreboard is what the supersack tracker already reads for exactly this
 * purpose, and two readers of one number should not compute it two ways.
 */

/**
 * Resolve a floor strain title to a cultivar NAME via cultivar_aliases.
 *
 * Not parsed. The floor's titles carry real-world noise the table already
 * knows about — "2025 - Sugar Cookez (Cookies) / Sungrown" resolves to
 * "Sugar Cookez", and "2024 - Bubba Kush 59 (HT) / Sungrown" to "Bubba Kush".
 * A regex would have silently produced zero allocations for every cultivar
 * whose title carries a suffix, and cultivar_aliases exists precisely so
 * nobody has to guess at that.
 */
async function resolveCultivars(db, titles) {
  const list = [...new Set(titles.filter(Boolean))];
  if (!list.length) return new Map();
  const ph = list.map(() => '?').join(',');
  const rows = await db.prepare(`
    SELECT a.alias, c.name
    FROM cultivar_aliases a
    JOIN cultivars c ON c.id = a.cultivar_id
    WHERE a.alias IN (${ph}) COLLATE NOCASE
  `).bind(...list).all();
  const out = new Map();
  for (const r of (rows.results || [])) out.set(String(r.alias).toLowerCase(), r.name);
  return out;
}

/**
 * @returns { byCultivar: Map<name,{tops,smalls,hours}>, unresolved: string[] }
 * Titles with no alias are REPORTED, not guessed at — an unresolved strain
 * means that day's output silently belongs to nobody.
 */
export async function floorOutputByCultivar(db, env, dayIso, apiBase) {
  const base = apiBase || 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
  const res = await fetch(`${base}/production?action=scoreboard&date=${encodeURIComponent(dayIso)}`,
    { headers: { 'User-Agent': 'harvest-allocator/1.0' } });
  if (!res.ok) throw new Error(`scoreboard ${res.status} for ${dayIso}`);
  const data = await res.json();
  const sb = data.scoreboard || data;

  const hours = Array.isArray(sb.hourlyRates) ? sb.hourlyRates : [];
  const raw = [];
  for (const h of hours) {
    if (!h || (!h.lbs && !h.smalls)) continue;
    raw.push({ title: h.strain || sb.strain, tops: Number(h.lbs) || 0, smalls: Number(h.smalls) || 0 });
  }
  // No hourly breakdown: fall back to day totals, safe only because such a day
  // has a single strain to attribute to.
  if (!raw.length && (sb.todayLbs || sb.todaySmalls)) {
    raw.push({ title: sb.strain, tops: Number(sb.todayLbs) || 0, smalls: Number(sb.todaySmalls) || 0 });
  }

  const names = await resolveCultivars(db, raw.map(r => r.title));
  const byCultivar = new Map();
  const unresolved = new Set();

  for (const r of raw) {
    const name = names.get(String(r.title || '').toLowerCase());
    if (!name) { if (r.title) unresolved.add(r.title); continue; }
    const cur = byCultivar.get(name) || { tops: 0, smalls: 0, hours: 0 };
    cur.tops += r.tops; cur.smalls += r.smalls; cur.hours += 1;
    byCultivar.set(name, cur);
  }
  for (const v of byCultivar.values()) {
    v.tops = Math.round(v.tops * 10) / 10;
    v.smalls = Math.round(v.smalls * 10) / 10;
  }
  return { byCultivar, unresolved: [...unresolved] };
}
