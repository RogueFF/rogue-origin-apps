/**
 * The order queue — the sidebar tile that says what's on the line right now,
 * and the drawer board that lays out the whole line-up behind it.
 *
 * The tile answers "what am I trimming"; the board answers "what's behind
 * it, and when does it land". The board is read-only except for one field:
 * a pass's "pounds done" can be typed over to CREDIT it — pounds the order
 * no longer needs the line to produce, because they were already in stock or
 * the lot overran. doneLbs itself is always replayed from recorded
 * production and can't be edited directly; see wireCreditFields below.
 *
 * Ports renderQueueStrip / renderQueueTab / wireCreditFields from
 * index.js:1784-2030 onto the v3 markup and this page's t()/api.
 *
 * `els` for renderQueueTile is id-keyed (main.js builds it): queueTile,
 * queueLead, queueFill, queueDone, queueOf, queueMeter, queueNext.
 *
 * A pass's `.qt-eta` renders the bare eta text ("Thu Sep 3 10:40 AM"), no
 * "done" prefix — that prefix belongs to the order-level `.qt-order-eta`
 * only ("order done …"), matching legacy exactly. floor.html's static
 * placeholder content reads "done Thu 10:40 AM" on the pass row; that's
 * mockup decoration, not the ported behaviour this function reproduces.
 */
import { num, esc, lbsText, etaText } from './format.js';
import { showToast } from '../shared/toast.js';

/**
 * The sidebar tile: what's on the line now (or next, or nothing).
 */
export function renderQueueTile(els, brief, t) {
  if (!brief || !brief.headline) {
    els.queueTile.hidden = true;
    return;
  }

  const { headline, next } = brief;
  els.queueTile.hidden = false;

  if (headline.mode === 'clear') {
    els.queueLead.textContent = t('queueClear');
    els.queueFill.hidden = true;
    return;
  }

  const tag = t(headline.mode === 'now' ? 'queueNow' : 'queueNext');
  // Two orders wanting the same cultivar is ordinary, so the "who" (nickname
  // or order ref) is what tells them apart on the tile, not just the strain.
  const bits = [headline.form, headline.nickname || headline.orderRef].filter(Boolean);
  const muted = bits.length ? ` <span class="muted">· ${esc(bits.join(' · '))}</span>` : '';
  els.queueLead.innerHTML = `${esc(tag)} <b>${esc(headline.cultivarName || '—')}</b>${muted}`;

  els.queueFill.hidden = false;
  // Nothing banked yet is an absence, not a measurement: the dash, as
  // everywhere else on the page.
  const done = Number(headline.doneLbs) || 0;
  els.queueDone.textContent = done > 0 ? num(done) : '—';
  els.queueOf.textContent = `/ ${num(headline.totalLbs, 0)}`;
  const pct = Math.max(0, Math.min(1, Number(headline.pct) || 0));
  els.queueMeter.firstElementChild.style.width = `${pct * 100}%`;

  if (next) {
    els.queueNext.innerHTML = `<svg class="i"><use href="#i-arrow-r"/></svg>${esc(t('queueNext'))} <b>${esc(next.cultivarName || '—')}</b>`;
    els.queueNext.hidden = false;
  } else {
    els.queueNext.hidden = true;
  }
}

/**
 * The drawer board: every order on the line, every pass, finished ones
 * included — a picture of the queue rather than a worklist.
 */
export function renderQueueBoard(host, brief, { t, api, onChanged }) {
  if (!brief) {
    host.innerHTML = `<div class="qt-empty">${esc(t('queueUnavailable'))}</div>`;
    return;
  }

  const rows = Array.isArray(brief.blocks) ? brief.blocks : [];
  if (!rows.length) {
    host.innerHTML = `<div class="qt-empty">${esc(t('queueClear'))}</div>`;
    return;
  }

  // The strain actually on the line, so the board agrees with the tile
  // instead of leaving the reader to work out which row is live.
  const head = brief.headline;
  const liveKey = head && head.mode !== 'clear' ? `${head.orderId}|${head.cultivarId}` : null;

  const html = rows.map((b, i) => {
    const ref = b.orderRef ? esc(b.orderRef) : '';
    const nick = b.nickname ? esc(b.nickname) : '';
    const who = ref && nick ? `${ref} · ${nick}` : (ref || nick || esc(b.orderId || ''));

    const passes = Array.isArray(b.passes) ? b.passes : [];
    const passHtml = passes.map((p) => {
      const pct = Math.max(0, Math.min(1, Number(p.pct) || 0));
      const left = Math.max(0, (Number(p.totalLbs) || 0) - (Number(p.doneLbs) || 0));
      const isLive = liveKey && `${b.orderId}|${p.cultivarId}` === liveKey;
      const state = pct >= 1 ? esc(t('qtDone')) : `${lbsText(left)} ${esc(t('qtLeft'))}`;
      const eta = pct >= 1 ? '' : etaText(p.finish);

      // A pass can hold two lines (tops and smalls off one lot); each is
      // credited independently, so each gets its own editable field.
      const lines = Array.isArray(p.lines) ? p.lines : [];
      const numbers = lines.length
        ? lines.map((l) => `
            <span class="qt-edit-row">
              ${lines.length > 1 ? `<span class="qt-edit-form">${esc(t(l.form) || l.form || '')}</span>` : ''}
              <input type="text" inputmode="decimal" class="qt-done-edit${(Number(l.creditedLbs) || 0) > 0 ? ' credited' : ''}"
                     value="${lbsText(l.doneLbs)}"
                     data-line-id="${esc(l.lineId || '')}"
                     data-qty="${Number(l.qtyLbs) || 0}"
                     data-credited="${Number(l.creditedLbs) || 0}"
                     data-done="${Number(l.doneLbs) || 0}"
                     aria-label="${esc(p.cultivarName || '')} ${esc(l.form || '')} ${esc(t('done_lbs'))}">
              <span class="qt-of">/ ${lbsText(l.qtyLbs)} lb</span>
            </span>`).join('')
        : `<span class="qt-lbs">${lbsText(p.doneLbs)} / ${lbsText(p.totalLbs)} lb</span>`;

      return `
        <div class="qt-pass${pct >= 1 ? ' done' : ''}${isLive ? ' live' : ''}" role="listitem">
          <span class="qt-cv">${esc(p.cultivarName || '—')}</span>
          <span class="qt-form">${esc(p.form || '')}</span>
          ${isLive ? `<span class="qt-now">${esc(t('qtNow'))}</span>` : ''}
          <span class="qt-nums">${numbers}</span>
          <span class="qt-state">${state}</span>
          <div class="qt-bar"><div class="qt-fill" style="width:${(pct * 100).toFixed(1)}%"></div></div>
          ${eta ? `<span class="qt-eta">${esc(eta)}</span>` : ''}
        </div>`;
    }).join('');

    const orderEta = etaText(b.finish);
    return `
      <div class="qt-order">
        <div class="qt-head">
          <span class="qt-rank">${i + 1}</span>
          <span class="qt-who">${who}</span>
          <span class="qt-pct">${Math.round((Number(b.pct) || 0) * 100)}%</span>
        </div>
        ${passHtml}
        ${orderEta ? `<div class="qt-order-eta">${esc(t('qtOrderDone'))} ${esc(orderEta)}</div>` : ''}
      </div>`;
  }).join('');

  const hiddenCount = (Number(brief.blocksTotal) || 0) - rows.length;
  const more = hiddenCount > 0 ? `<div class="qt-more">+${hiddenCount} ${esc(t('moreOnBoard'))}</div>` : '';
  host.innerHTML = html + more;
  wireCreditFields(host, { t, api, onChanged });
}

/**
 * Commit a typed "pounds done" as a CREDIT. doneLbs is replayed from
 * recorded production on every read and cannot be written to; what's stored
 * is the gap between what the floor actually trimmed and the number typed
 * here. Ported from wireCreditFields index.js:1962-2010 verbatim.
 */
function wireCreditFields(root, { t, api, onChanged }) {
  root.querySelectorAll('.qt-done-edit').forEach((input) => {
    const lineId = input.dataset.lineId;
    const qty = Number(input.dataset.qty) || 0;
    const credited = Number(input.dataset.credited) || 0;
    const done = Number(input.dataset.done) || 0;
    // What production actually put here; the rest of `done` is credit already.
    const trimmed = Math.max(0, done - credited);
    const shown = lbsText(done);

    const revert = () => { input.value = shown; };

    const commit = async () => {
      const next = Number(input.value);
      if (!Number.isFinite(next) || next < 0) { revert(); return; }
      if (Math.abs(next - done) < 0.001) return;

      // Typing below what the floor already trimmed is refused, not clamped:
      // those hours already happened and this field can't un-log them.
      if (next < trimmed - 0.001) {
        showToast(`${t('err_below_trimmed')} ${lbsText(trimmed)} lb`, 'error');
        revert();
        return;
      }
      if (next > qty + 0.001) {
        showToast(`${t('err_above_ordered')} ${lbsText(qty)} lb`, 'error');
        revert();
        return;
      }

      input.disabled = true;
      try {
        await api.setLineCredit({ lineId, creditedLbs: Math.max(0, next - trimmed) });
        onChanged?.();
      } catch (err) {
        console.error('Could not set credit:', err);
        showToast(t(/unauthor|401|password/i.test(String(err && err.message))
          ? 'err_password_needed' : 'err_save_credit'), 'error');
        revert();
      } finally {
        input.disabled = false;
      }
    };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { revert(); input.blur(); }
    });
  });
}
