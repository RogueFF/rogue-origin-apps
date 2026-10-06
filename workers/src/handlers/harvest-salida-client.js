/**
 * /salida browser code. Serialised into the page with toString() and run with
 * the logic functions from harvest-salida-logic.js already in scope — it is
 * never called in Node. Test hook: open /salida?sim=1 to get a box that feeds
 * any text through the exact camera path, or call window.salidaSim('<text>').
 * Screenshot hook (sim=1 only): ?sim=1&feed=26-SLIFT-7,26-SLIFT-7,https://x
 * feeds those strings through the scan path one after another (1.2 s apart,
 * debounce bypassed) after load, so a headless screenshot shows the result.
 */
/* global parseTag, isScannerBurst, debounceSeen, queueReduce, pacificTime, countText, busyRetry,
          undoNeedsConfirm, orderChips, rememberCode, queueLoad, feedbackFor, groupToday, escapeHtml, embedJson,
          BarcodeDetector */
// The names above are the LOGIC_SOURCE functions inlined ahead of this code in
// the page (same order as harvest-salida-logic.js), plus the browser's QR API.
export function salidaMain(boot, S, decoderUrl) {
  const $ = (id) => document.getElementById(id);
  const api = boot.api || '/api/harvest';
  const QKEY = 'salida.queue.v1', CKEY = 'salida.cultivar.v1', RKEY = 'salida.recent.v1';
  const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: keep going */ } } };
  let today = boot.today || {}, seen = {}, last = null, undoTimer = 0, code = store.get(CKEY, ''), num = '';
  const mine = new Set();

  // ---- sound + buzz (audio unlocked on first gesture, iOS needs that) ----
  let ac = null;
  const unlock = () => { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch (e) { ac = null; } };
  addEventListener('pointerdown', unlock, { once: true }); addEventListener('keydown', unlock, { once: true });
  function beep(kind) {
    if (!ac) return;
    const tones = { ok: [[880, 0, 0.12]], warn: [[520, 0, 0.12], [520, 0.2, 0.12]], bad: [[200, 0, 0.5]] }[kind] || [];
    for (const [f, at, len] of tones) {
      const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.type = 'square';
      g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + len);
    }
  }
  let idleTimer = 0;
  function idle() { $('sfb').className = 'sfb idle'; $('sfbicon').textContent = '➜'; $('sfbline').textContent = S.idle; }
  function show(fb, resp) {
    const box = $('sfb'); box.className = 'sfb ' + fb.tone; $('sfbicon').textContent = fb.icon || ''; $('sfbline').textContent = fb.line;
    clearTimeout(idleTimer); if (fb.tone !== 'wait' && fb.tone !== 'pick') idleTimer = setTimeout(idle, fb.tone === 'ok' ? 6000 : 12000);
    if (fb.tone === 'wait') return;
    document.body.classList.remove('flash-ok', 'flash-warn', 'flash-bad'); void document.body.offsetWidth;
    document.body.classList.add('flash-' + (fb.tone === 'pick' ? 'warn' : fb.tone));
    if (navigator.vibrate && fb.vibrate && fb.vibrate.length) navigator.vibrate(fb.vibrate); beep(fb.beep);
    const pick = $('spick'); pick.textContent = '';
    if (resp && resp.state === 'ambiguous') for (const c of resp.candidates || []) {
      pick.appendChild(button(c.cultivar + ' #' + c.serial, 'big', () => send({ q: c.sack_id, by: 'typed', order_id: null })));
    }
    renderLast(resp && resp.sack && (fb.tone === 'ok' || fb.undoLive) ? resp : null);
  }
  function button(text, cls, fn) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.onclick = fn; return b; }

  // ---- last sack: order switch + undo ----
  function renderLast(resp) {
    const box = $('slast'); box.textContent = ''; clearInterval(undoTimer);
    if (!resp) { box.hidden = !last; if (last) renderLast(last); return; }
    last = resp; box.hidden = false;
    const cur = resp.order ? resp.order.id : 'stock';
    const row = document.createElement('div'); row.className = 'sorders';
    for (const o of (resp.order_options || []).concat([{ id: 'stock', nickname: S.toStock }])) {
      const b = button(o.nickname || o.shopify_order_name || '?', 'chip' + (o.id === cur ? ' on' : ''), () => assign(resp.sack.sack_id, o.id));
      row.appendChild(b);
    }
    box.appendChild(row);
    const until = Date.parse(resp.undo_until || '') || 0;
    if (until > Date.now()) {
      const u = button(S.undo, 'undo', () => undo(resp.sack.sack_id)); box.appendChild(u);
      undoTimer = setInterval(() => { const left = Math.round((until - Date.now()) / 1000);
        if (left <= 0) { u.remove(); clearInterval(undoTimer); } else u.textContent = S.undo + ' · ' + left + 's'; }, 1000);
    }
  }

  // ---- network ----
  async function post(action, body) {
    const r = await fetch(api + '?action=' + action, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    if (!r.ok && r.status >= 500) throw new Error('http ' + r.status);
    const raw = await r.json(); return raw.data || raw;
  }
  async function send(payload, key, tries) {
    const k = key || (payload.q ? 'q:' + payload.q : 't:' + payload.code + '-' + payload.number);
    try {
      const resp = await post('sack_out', payload);
      if (resp && resp.state === 'busy') { const wait = busyRetry(tries || 0);
        if (wait != null) { show(feedbackFor(resp, S, false), resp); await new Promise((ok) => setTimeout(ok, wait)); return send(payload, key, (tries || 0) + 1); }
        show(feedbackFor({ state: 'stuck' }, S, false), null); return key ? true : 'bad'; }
      if (key) { queue('done', k); mine.add(k); }
      const fb = feedbackFor(resp, S, mine.has(k)); show(fb, resp); refresh();
      return key ? true : fb.tone;
    } catch (e) {
      if (!key) { queue('add', k, payload); show({ tone: 'warn', icon: '⇪', vibrate: [60], beep: 'warn', line: S.queued }, null); return 'queued'; }
      else queue('fail', k);
      return false;
    }
  }
  async function assign(sackId, orderId) { try { const r = await post('sack_out_assign', { sack_id: sackId, order_id: orderId });
    if (last && r.sack) renderLast(Object.assign({}, last, { order: r.order, order_options: r.order_options || last.order_options })); refresh(); } catch (e) { show(feedbackFor({ state: 'error' }, S), null); } }
  async function undo(sackId) {
    try { const r = await post('sack_out_undo', { sack_id: sackId });
      const st = r.state === 'undone' ? 'ok' : 'bad';
      show({ tone: st, icon: st === 'ok' ? '✓' : '✕', vibrate: st === 'ok' ? [90] : [500], beep: st, line: S[r.state] || S.error }, null);
      if (r.state === 'undone') { last = null; $('slast').hidden = true; } refresh();
    } catch (e) { show(feedbackFor({ state: 'error' }, S), null); }
  }
  function queue(type, key, payload) {
    store.set(QKEY, queueReduce(store.get(QKEY, []), { type, key, payload, at: Date.now() })); renderList();
  }
  let flushing = false;
  async function flush() {
    if (flushing) return; flushing = true;
    try { for (const item of store.get(QKEY, [])) { mine.add(item.key); if (!(await send(item.payload, item.key))) break; } }
    finally { flushing = false; }
  }
  async function refresh() {
    if (document.hidden) return;
    try { const r = await fetch(api + '?action=sack_out_today'); const raw = await r.json(); today = raw.data || raw; renderChips(); renderList(); } catch (e) { /* offline: keep last list */ }
  }

  // ---- today's list ----
  function renderList() {
    const host = $('slist'); host.textContent = ''; const qn = queueReduce(store.get(QKEY, []), null).length;
    $('sbanner').hidden = !qn; $('sbanner').textContent = '⇪ ' + S.waiting.replace('{n}', qn);
    for (const g of groupToday(today, queueReduce(store.get(QKEY, []), null), S)) {
      const sec = document.createElement('section'); sec.className = 'sgroup' + (g.pending ? ' pending' : '');
      const h = document.createElement('h3'); const nm = document.createElement('b'); nm.textContent = g.pending ? g.title : g.dest;
      const cv = document.createElement('small'); cv.textContent = g.pending ? '' : g.cultivar; const c = document.createElement('span'); c.textContent = g.count;
      h.append(nm, cv, c); sec.appendChild(h);
      if (g.need) { const bar = document.createElement('div'); bar.className = 'sbar'; const fill = document.createElement('i');
        fill.style.width = Math.min(100, Math.round(100 * g.n / g.need)) + '%'; bar.appendChild(fill); sec.appendChild(bar); }
      for (const row of g.rows) {
        const d = document.createElement('div'); d.className = 'srow';
        for (const t of ['#' + row.serial, row.zone, row.cut, row.time]) { const s = document.createElement('span'); s.textContent = t; d.appendChild(s); }
        if (!g.pending && row.can_undo) { let armed = 0; const b = button('↶ ' + S.rowUndo, 'rowundo', () => {
          if (!undoNeedsConfirm(row.opened_at, Date.now()) || Date.now() - armed < 4000) return undo(row.sack_id);
          armed = Date.now(); b.textContent = S.confirm; b.classList.add('arm'); setTimeout(() => { b.textContent = '↶ ' + S.rowUndo; b.classList.remove('arm'); }, 4000); });
          b.setAttribute('aria-label', S.rowUndo + ' #' + row.serial); d.appendChild(b); } else d.appendChild(document.createElement('span'));
        sec.appendChild(d);
      }
      host.appendChild(sec);
    }
  }

  // ---- typed path ----
  function renderChips() {
    const host = $('schips'); host.textContent = '';
    for (const ch of orderChips(today.chips, store.get(RKEY, []))) {
      const b = button((ch.code === code ? '✓ ' : '') + (ch.cultivar || ch.code), 'chip' + (ch.code === code ? ' on' : ''), () => { code = ch.code; store.set(CKEY, code); store.set(RKEY, rememberCode(store.get(RKEY, []), code)); renderChips(); focusNum(); });
      b.setAttribute('aria-pressed', ch.code === code ? 'true' : 'false');
      const cd = document.createElement('small'); cd.textContent = ch.code; const n = document.createElement('em'); n.textContent = ch.in_inventory ?? '';
      b.append(cd, n); host.appendChild(b);
    }
  }
  // Desktop only: on a phone a focused field pops the soft keyboard over the camera and pad.
  function focusNum() { if (window.matchMedia && matchMedia('(pointer: fine)').matches) $('snum').focus(); }
  function setNum(v) { num = String(v).replace(/\D/g, '').slice(0, 5); $('snum').value = num; }
  function submitTyped() {
    if (!num) return;
    if (!code) { show({ tone: 'bad', vibrate: [500], beep: 'bad', line: S.pickCultivar }, null); return; }
    store.set(RKEY, rememberCode(store.get(RKEY, []), code));
    send({ code, number: Number(num), by: 'typed', order_id: null }).then((t) => { if (t === 'ok' || t === 'queued') setNum(''); focusNum(); });
  }
  $('spad').addEventListener('click', (e) => { const k = e.target.closest('button'); if (!k) return;
    if (k.dataset.k === 'del') setNum(num.slice(0, -1)); else if (k.dataset.k === 'clr') setNum(''); else if (k.dataset.k === 'go') submitTyped(); else setNum(num + k.dataset.k); });
  $('snum').addEventListener('input', (e) => setNum(e.target.value));

  // ---- scans (camera, sim, handheld scanner) ----
  function onScanText(text) {
    const tag = parseTag(text); if (!tag) return; // not ours: ignore without nagging
    const d = debounceSeen(seen, tag.id, Date.now(), 4000); seen = d.seen; if (!d.accept) return;
    send({ q: tag.id, by: 'scan', order_id: null });
  }
  window.salidaSim = onScanText;
  // Handheld scanners type the tag + Enter, maybe into the number field. Keys
  // are buffered; on Enter, a fast tag-shaped burst is a scan, anything else
  // is the typed path.
  let keys = [];
  addEventListener('keydown', (e) => {
    if (e.target && e.target.id === 'ssim') return;
    if (e.key === 'Enter') {
      const burst = keys; keys = [];
      // A sack id is never a bag number: tag-shaped text is a scan at any speed
      // (slow Bluetooth scanners), so it can never become a typed 26151.
      if (isScannerBurst(burst) || parseTag(burst.map((k) => k.ch).join(''))) { e.preventDefault(); setNum(''); onScanText(burst.map((k) => k.ch).join('')); return; }
      if (e.target.tagName !== 'BUTTON') { e.preventDefault(); submitTyped(); } return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      if (keys.length && e.timeStamp - keys[keys.length - 1].t > 1500) keys = []; // a long pause ends any burst
      keys.push({ ch: e.key, t: e.timeStamp });
      if (e.target.id !== 'snum') { if (/\d/.test(e.key)) setNum(num + e.key); }
    } else if (e.key === 'Backspace' && e.target.id !== 'snum') setNum(num.slice(0, -1));
  }, true);

  // ---- camera ----
  let stream = null, track = null, detector = null, jsqr = null, busy = false;
  async function loadJsqr() {
    if (window.jsQR) return window.jsQR;
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = decoderUrl; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
    if (!window.jsQR) throw new Error('decoder missing'); // falls to type mode, not a dead camera
    return window.jsQR;
  }
  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      const v = $('svideo'); v.srcObject = stream; await v.play(); track = stream.getVideoTracks()[0];
      if ('BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
      else jsqr = await loadJsqr();
      $('scam').hidden = false; $('snocam').hidden = true; $('sstat').textContent = S.looking;
      const caps = track.getCapabilities ? track.getCapabilities() : {}; $('storch').hidden = !caps.torch;
      tick();
    } catch (e) {
      // Say WHY in one word, because "no camera" on a phone that has one is a
      // permission or a browser problem, and the fix differs: NotAllowedError
      // is the site blocked in settings; NotFoundError is no camera at all.
      $('scam').hidden = true; $('snocam').hidden = false; $('snum').focus();
      $('snocamwhy').textContent = e && e.name ? `(${e.name})` : '';
    }
  }
  const canvas = document.createElement('canvas'), cx = canvas.getContext('2d', { willReadFrequently: true });
  async function tick() {
    if (!stream) return;
    const v = $('svideo');
    if (!busy && !document.hidden && v.readyState >= 2) {
      busy = true;
      try {
        if (detector) { for (const c of await detector.detect(v)) onScanText(c.rawValue); }
        else if (jsqr) { const w = 640, h = Math.round(640 * v.videoHeight / v.videoWidth) || 480; canvas.width = w; canvas.height = h;
          cx.drawImage(v, 0, 0, w, h); const r = jsqr(cx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r) onScanText(r.data); }
      } catch (e) { /* one bad frame is not a fault */ }
      busy = false;
    }
    setTimeout(() => requestAnimationFrame(tick), detector ? 120 : 200);
  }
  let torchOn = false;
  $('storch').onclick = () => { torchOn = !torchOn; track && track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {}); };
  $('sretry').onclick = startCamera;

  // ---- wake lock, timers, sim ----
  let lock = null;
  const wake = async () => { try { if ('wakeLock' in navigator && !document.hidden) lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { wake(); refresh(); flush(); } });
  addEventListener('online', flush);
  setInterval(() => { if (!document.hidden) { refresh(); flush(); } }, 5000);
  if (/[?&]sim=1/.test(location.search)) { $('ssimbox').hidden = false;
    $('ssim').addEventListener('keydown', (e) => { if (e.key === 'Enter') { onScanText(e.target.value); e.target.value = ''; } }); }

  const feed = /[?&]sim=1/.test(location.search) && /[?&]feed=([^&]*)/.exec(location.search);
  if (feed) decodeURIComponent(feed[1]).split(',').forEach((t, i) => setTimeout(() => { seen = {}; onScanText(t); }, 800 + i * 1200));
  idle(); renderChips(); renderList(); wake(); flush();
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) startCamera(); else { $('snocam').hidden = false; }
  focusNum();
}
