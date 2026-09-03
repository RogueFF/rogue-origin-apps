/**
 * What the trim floor actually produced, per strain, on a given day — every
 * part a supersack breaks into, not just the finished flower.
 *
 * Nobody weighs a supersack's output on its own. The floor records a day's
 * total per strain, and a bag's share is that total divided among the bags of
 * that strain opened the same day.
 *
 * SOURCE: `supersack_entries`, the trim floor's own daily row per (date,
 * strain). It carries all five parts — tops, smalls, biomass, trim, waste —
 * plus the floor's own count of sacks opened. The production scoreboard, which
 * this used to read, only carries tops and smalls; taking those from one source
 * and the rest from another would be two readers of one number computing it two
 * ways, which is the drift this file exists to avoid.
 *
 * The trade-off, taken deliberately: the scoreboard is written live from the
 * floor, while a `supersack_entries` row is entered per day and can lag or be
 * back-entered. The allocator answers that by replaying a trailing window
 * rather than only ever looking at yesterday, so a late row still lands.
 *
 * WASTE IS DERIVED, NOT WEIGHED — `raw - tops - smalls - biomass - trim`, with
 * `raw = sacks x 37`. It absorbs every error in the other four. Carried through
 * so the material balance survives, and kept labelled so it is never read as a
 * measurement.
 *
 * Rows carry `strain` in Shopify variant-title form ("2025 - Sugar Cookez
 * (Cookies) / Sungrown"), the same key the Super Sack Inventory uses, so floor
 * output joins to a cultivar without a separate mapping.
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
 * Season off the front of a strain title: "2025 - Lifter / Sungrown" -> 2025.
 *
 * The year prefix is structural and safe to read directly, unlike the cultivar
 * name, which needs the alias table. Keeping it is not optional: the floor
 * spends part of 2026 trimming 2025 material, and a 2025 Lifter day whose
 * output landed on 2026 Lifter bags would invent yield for a crop that had not
 * been processed yet.
 */
function seasonFromStrainTitle(title) {
  const m = String(title || '').match(/^\s*(\d{4})\s*-/);
  return m ? Number(m[1]) : null;
}

/**
 * @returns { byKey: Map<"season|cultivar", {season, cultivar, tops, smalls,
 *                       biomass, trim, waste, floorSacks}>,
 *            unresolved: string[] }
 *
 * `floorSacks` is the FLOOR'S OWN count of sacks opened that day. It is a
 * cross-check, never the divisor — the share goes to the bags that carry tags,
 * and those are counted from `harvest_sacks`. When the two disagree, somebody
 * missed an ABRIR BOLSA or missed a tracker row, and dividing quietly by the
 * smaller number over-credits every bag.
 *
 * Keyed by season AND cultivar. Titles with no alias are REPORTED, not guessed
 * at — an unresolved strain means that day's output belongs to nobody. The
 * season prefix matters just as much: the floor spends part of 2026 trimming
 * 2025 material, and that output must not land on 2026 bags.
 */
export async function floorOutputByCultivar(db, env, dayIso) {
  const rows = await db.prepare(`
    SELECT strain, sacks_opened, tops_lbs, smalls_lbs, biomass_lbs, trim_lbs, waste_lbs
    FROM supersack_entries WHERE date = ?
  `).bind(dayIso).all();

  const raw = (rows.results || []).map(r => ({
    title: r.strain,
    tops: Number(r.tops_lbs) || 0,
    smalls: Number(r.smalls_lbs) || 0,
    biomass: Number(r.biomass_lbs) || 0,
    trim: Number(r.trim_lbs) || 0,
    waste: Number(r.waste_lbs) || 0,
    floorSacks: Number(r.sacks_opened) || 0,
  })).filter(r => r.tops || r.smalls || r.biomass || r.trim || r.waste);

  const names = await resolveCultivars(db, raw.map(r => r.title));
  const byKey = new Map();
  const unresolved = new Set();

  for (const r of raw) {
    const name = names.get(String(r.title || '').toLowerCase());
    const season = seasonFromStrainTitle(r.title);
    // A title without a resolvable cultivar OR without a year cannot be
    // attributed to a bag. Report it rather than pick a season.
    if (!name || !season) { if (r.title) unresolved.add(r.title); continue; }
    const key = `${season}|${name}`;
    const cur = byKey.get(key)
      || { season, cultivar: name, tops: 0, smalls: 0, biomass: 0, trim: 0, waste: 0, floorSacks: 0 };
    // Summed rather than assigned: one cultivar can appear under several strain
    // titles that all alias to it (a cultivar renamed mid-season, say).
    for (const k of ['tops', 'smalls', 'biomass', 'trim', 'waste', 'floorSacks']) cur[k] += r[k];
    byKey.set(key, cur);
  }
  for (const v of byKey.values()) {
    for (const k of ['tops', 'smalls', 'biomass', 'trim', 'waste']) {
      v[k] = Math.round(v[k] * 10) / 10;
    }
  }
  return { byKey, unresolved: [...unresolved] };
}
