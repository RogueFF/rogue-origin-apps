/**
 * The queue brief — a small, read-only projection of the board for surfaces
 * that are not the board: the Ops Hub widget and the hourly-entry banner.
 *
 * Pure. Takes the already-computed blocks and returns a shape small enough to
 * put on a phone. `getQueue` carries roughly ten times this — most of it the
 * `unallocated` array, which grows with the 60-day replay window and is
 * unreadable on either surface.
 *
 * TWO THINGS HERE ARE LOAD-BEARING.
 *
 * WHICH PASS IS "CURRENT". Allocation matches by cultivar, not by pass order,
 * so a block's later pass can be complete while its first has not started —
 * that is the live shape of MO-2026-002. The current pass is therefore the
 * first one with pounds still owed, which is neither "pass 0" nor "the last
 * pass with progress"; both of those name a cultivar nobody is working on.
 *
 * WHY ALIASES LEAVE HERE AS WHOLE STRINGS. The queue speaks in cultivar ids
 * and display names ('purple-frosty', 'Purple Frosty'). The hourly-entry
 * dropdown speaks in production spellings ('2025 - Purple Frosty / Sungrown').
 * Measured against live data, a naive strip-the-year match between the two
 * scores 0 out of 23 — and a float-to-top that floats nothing looks exactly
 * like one that works. `cultivar_aliases.alias` already holds the dropdown
 * string verbatim, because it is joined straight onto
 * `monthly_production.cultivar1`. So the resolution stays on this side and the
 * client compares with `===`. A second, client-side copy of that mapping is
 * the thing that has already drifted twice in this codebase.
 */

/** Pounds still owed on a line, however the caller spelled it. */
function remainingOf(l) {
  if (typeof l.remainingLbs === "number") return l.remainingLbs;
  return (Number(l.qtyLbs) || 0) - (Number(l.doneLbs) || 0);
}

/** The lines of a pass that still owe pounds. */
function openLines(p) {
  return (p.lines || []).filter(l => remainingOf(l) > 0);
}

/** Every pass with work left, flattened into queue order. */
function openPasses(blocks) {
  const out = [];
  for (const b of blocks || []) {
    for (const p of b.passes || []) {
      if (openLines(p).length) out.push({ block: b, pass: p });
    }
  }
  return out;
}

/**
 * The forms still owed, in the order the lines carry them.
 *
 * Tops and smalls of one cultivar come off the same trim pass, so a pass can
 * owe both — but once one of them is satisfied the surplus falls out and only
 * the other is still being worked. Naming both there would be wrong.
 */
function formsOf(p) {
  const forms = [];
  for (const l of openLines(p)) {
    if (l.form && !forms.includes(l.form)) forms.push(l.form);
  }
  return forms.join(" + ") || null;
}

/** A pass, told as the banner tells it. Pass pounds, not order pounds. */
function spot({ block, pass }, orderOf) {
  const lines = pass.lines || [];
  const doneLbs = lines.reduce((s, l) => s + (Number(l.doneLbs) || 0), 0);
  const totalLbs = lines.reduce((s, l) => s + (Number(l.qtyLbs) || 0), 0);
  const o = orderOf.get(block.orderId) || null;

  return {
    cultivarId: pass.cultivarId ?? null,
    cultivarName: pass.cultivarName ?? null,
    form: formsOf(pass),
    orderId: block.orderId ?? null,
    // Both, unmerged. The widget puts the number and the nickname in different
    // places, so the brief must not pick a winner the way orderLabel() does for
    // a Telegram sentence.
    orderRef: o?.shopifyOrderName ?? null,
    nickname: o?.nickname ?? null,
    doneLbs,
    totalLbs,
    pct: totalLbs > 0 ? doneLbs / totalLbs : 0,
  };
}

const CLEAR = {
  mode: "clear",
  cultivarId: null, cultivarName: null, form: null,
  orderId: null, orderRef: null, nickname: null,
  doneLbs: 0, totalLbs: 0, pct: 0,
};

/**
 * @param {object}   args
 * @param {Array}    args.blocks   scheduled blocks, cultivarName already attached
 * @param {Array}    args.orders   [{ id, nickname, shopifyOrderName }]
 * @param {Array}    args.aliases  [{ alias, cultivarId }] for the current crop year
 * @param {number}   [args.limit]  how many block rows the widget can show
 */
export function buildQueueBrief({ blocks = [], orders = [], aliases = [], limit = 4 } = {}) {
  const orderOf = new Map((orders || []).map(o => [o.id, o]));
  const open = openPasses(blocks);

  // A block is live if anything in it is still owed. Finished blocks stay in
  // the computation — they hold their claim on past pounds — but they are not
  // work anybody is waiting on, so they are not rows.
  const live = (blocks || []).filter(b => (b.passes || []).some(p => openLines(p).length));

  // MODE IS DECIDED BY WORK, NOT BY THE CLOCK. MO-2026-002's own start is
  // 16:31, past the 16:20 productive end, so a clock-based "now trimming"
  // would have been false on the day this shipped.
  const headline = open.length
    ? { mode: (Number(open[0].block.doneLbs) || 0) > 0 ? "now" : "next", ...spot(open[0], orderOf) }
    : { ...CLEAR };

  const next = open.length > 1 ? spot(open[1], orderOf) : null;

  const rows = live.slice(0, limit).map((b) => {
    const p = (b.passes || []).find(x => openLines(x).length);
    const o = orderOf.get(b.orderId) || null;
    const totalLbs = Number(b.totalLbs) || 0;
    const doneLbs = Number(b.doneLbs) || 0;

    return {
      orderId: b.orderId ?? null,
      orderRef: o?.shopifyOrderName ?? null,
      nickname: o?.nickname ?? null,
      // The cultivar the order is WAITING on, not the one it started with.
      cultivarName: p?.cultivarName ?? null,
      form: p ? formsOf(p) : null,
      doneLbs,
      totalLbs,
      pct: typeof b.pct === "number" ? b.pct : (totalLbs > 0 ? doneLbs / totalLbs : 0),
      finish: b.finish ?? null,

      // EVERY pass, finished ones included. The headline names only work still
      // to do, because it answers "what now"; this list is a picture of the
      // order, and dropping the finished strains would make a half-done order
      // look smaller than it is. Tops and smalls of one cultivar stay ONE row —
      // they come off a single lot in a single pass, so splitting them would
      // imply two stretches of floor time that do not exist.
      passes: (b.passes || []).map((p) => {
        const lines = p.lines || [];
        const passTotal = lines.reduce((s, l) => s + (Number(l.qtyLbs) || 0), 0);
        const passDone = lines.reduce((s, l) => s + (Number(l.doneLbs) || 0), 0);
        return {
          cultivarId: p.cultivarId ?? null,
          cultivarName: p.cultivarName ?? null,
          form: formsOf(p),
          doneLbs: passDone,
          totalLbs: passTotal,
          pct: passTotal > 0 ? passDone / passTotal : 1,
          finish: p.finish ?? null,
        };
      }),
    };
  });

  // Cultivars with work left, in queue order, each contributing every spelling
  // the production sheet has ever used for it. A cultivar with no alias row
  // contributes nothing: floating a string the dropdown does not contain would
  // offer a value the save path rejects.
  const wanted = [];
  for (const { pass } of open) {
    if (pass.cultivarId && !wanted.includes(pass.cultivarId)) wanted.push(pass.cultivarId);
  }
  const queueAliases = wanted.flatMap(
    id => (aliases || []).filter(a => a.cultivarId === id).map(a => a.alias));

  return {
    headline,
    next,
    blocks: rows,
    blocksTotal: live.length,
    queueAliases,
  };
}
