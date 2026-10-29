/**
 * Page gate: the shared-password lock in front of the internal pages.
 *
 * Loaded as the FIRST script in <head>, synchronous and classic (not a module),
 * so it runs before first paint and before any inline script on the page:
 *
 *   <script src="../js/shared/page-gate.js?h=..."></script>
 *
 * What it does, in order:
 *   1. Hides the document (class on <html> plus an injected style).
 *   2. Wraps window.fetch so every request to the API origin waits until the
 *      page is unlocked. The pages fetch from inline classic scripts the moment
 *      they parse, so holding module imports alone would not be enough.
 *   3. Unlocks with the same password, storage key and endpoint the rest of the
 *      hub uses (ro_api_password, /api/orders?action=validatePassword), so one
 *      unlock covers every gated page plus Wholesale writes, SOP, Floor Manager
 *      credits and the Hub cost lock.
 *
 * Load behaviour:
 *   no stored key                 -> show the dialog
 *   stored key, server says yes   -> reveal
 *   stored key, 401/success:false -> forget it, show the dialog
 *   stored key, offline/timeout   -> reveal anyway (barn PC on bad wifi, or a
 *                                    page the service worker served offline)
 *
 * This locks the UI only. The API itself still answers anyone who calls it.
 *
 * The decision logic is a set of pure functions published as
 * globalThis.ROGateCore; tests/page-gate.test.mjs runs this very file in a vm
 * sandbox (no document) to exercise them.
 */
(function () {
  'use strict';

  const API_ORIGIN = 'https://rogue-origin-api.roguefamilyfarms.workers.dev';
  const VALIDATE_URL = `${API_ORIGIN}/api/orders?action=validatePassword`;
  const PASSWORD_KEY = 'ro_api_password';
  // Mirrors src/js/shared/i18n.js: the language lives in localStorage, with
  // these legacy keys still honoured (i18n migrates them; we only read).
  const LANG_KEY = 'ro-lang';
  const LEGACY_LANG_KEYS = ['barcodeLang', 'kanbanLang', 'sopAppLang', 'supersack-lang', 'lang', 'language'];
  const STORED_CHECK_MS = 3000;   // stored key: short, then fail open
  const TYPED_CHECK_MS = 10000;   // typed password: someone is waiting on it
  const WAIT_HINT_MS = 400;       // stored check slower than this: say "Checking…"

  // -- Pure decisions ------------------------------------------------------

  /** True when a fetch input (string, URL or Request) targets the API origin. */
  function isApiUrl(input, base) {
    let raw = input;
    if (raw && typeof raw === 'object') raw = raw.href || raw.url;
    if (typeof raw !== 'string' || !raw) return false;
    try {
      return new URL(raw, base).origin === API_ORIGIN;
    } catch {
      return false;
    }
  }

  /**
   * Read a validatePassword response, in the shape wholesale/auth.js reads it
   * ((raw.data || raw).success), but strictly: only a boolean true unlocks.
   * Only an answer from the server counts as a rejection: a 401, or a 2xx
   * whose success is anything but true ("false", 1, ...). Anything else (5xx,
   * the service worker's offline 408, a non-JSON body, no success field) is an
   * 'error', which a stored key survives.
   */
  function classifyValidation({ ok, status, body }) {
    if (status === 401) return 'rejected';
    const result = body && typeof body === 'object' ? (body.data || body) : null;
    if (!result || typeof result !== 'object' || !ok) return 'error';
    if (result.success === true) return 'ok';
    if ('success' in result) return 'rejected';
    return 'error';
  }

  const decideLoad = (storedKey) => (storedKey ? 'validate' : 'prompt');

  const afterStoredCheck = (outcome) => (outcome === 'rejected' ? 'forget-and-prompt' : 'reveal');

  /** stored: whether the password could be written to localStorage. */
  function afterTyped(outcome, stored) {
    if (outcome === 'ok') return stored ? 'store-and-reload' : 'reveal';
    if (outcome === 'rejected') return 'wrong';
    return 'offline';
  }

  /**
   * 'en' | 'es' from the same signal i18n.js uses; 'both' if storage throws.
   * fixed: the page's own pin (data-lang on the gate tag), for pages with no
   * language toggle; it wins over storage.
   */
  function pickLang(read, fixed) {
    if (fixed === 'en' || fixed === 'es') return fixed;
    try {
      const v = read(LANG_KEY);
      if (v === 'en' || v === 'es') return v;
      for (const k of LEGACY_LANG_KEYS) {
        const legacy = read(k);
        if (legacy === 'en' || legacy === 'es') return legacy;
      }
      return 'en'; // i18n.js's own default, so the dialog matches the page
    } catch {
      return 'both';
    }
  }

  globalThis.ROGateCore = {
    API_ORIGIN, PASSWORD_KEY, isApiUrl, classifyValidation, decideLoad, afterStoredCheck, afterTyped, pickLang,
  };

  // -- Browser -------------------------------------------------------------

  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.ROGate) return; // loaded twice: the first copy owns the page

  const root = document.documentElement;

  // A page with no language toggle pins the dialog language on the gate tag:
  //   <script src="../js/shared/page-gate.js" data-lang="en"></script>
  // Read now: currentScript is only set while this script first runs.
  const pinnedLang = (() => {
    try {
      const v = document.currentScript && document.currentScript.getAttribute('data-lang');
      return v === 'en' || v === 'es' ? v : null;
    } catch {
      return null;
    }
  })();

  const store = {
    get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
    set(k, v) { try { localStorage.setItem(k, v); return localStorage.getItem(k) === v; } catch { return false; } },
    remove(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
  };

  // 1. Hide everything but the gate, before the body is even parsed.
  root.classList.add('ro-gated');
  const style = document.createElement('style');
  style.id = 'ro-gate-style';
  style.textContent = `
html.ro-gated body { visibility: hidden !important; }
html.ro-gated body > #ro-gate { visibility: visible !important; }
#ro-gate {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  background: var(--bg, #141816); color: var(--text, #e8e4dc);
  font-family: var(--font-ui, system-ui, -apple-system, 'Segoe UI', sans-serif);
}
#ro-gate form {
  width: 100%; max-width: 380px; box-sizing: border-box; margin: 0;
  display: flex; flex-direction: column; gap: 12px; padding: 28px 24px;
  background: var(--bg-card, var(--card, #1d231f));
  border: 1px solid var(--border, var(--card-border, rgba(102, 137, 113, 0.25)));
  border-radius: 16px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}
#ro-gate form[hidden] { display: none; }
#ro-gate .ro-gate-icon { color: var(--ro-gold, var(--gold, #e4aa4f)); width: 32px; height: 32px; }
#ro-gate h1 { margin: 0; font-size: 22px; line-height: 1.25; font-weight: 600; white-space: pre-line; }
#ro-gate p { margin: 0; font-size: 15px; line-height: 1.4; white-space: pre-line;
  color: var(--text-secondary, var(--text-dim, #9aa59c)); }
#ro-gate label { font-size: 14px; font-weight: 600; margin-top: 4px; }
#ro-gate input {
  width: 100%; box-sizing: border-box; min-height: 52px; padding: 12px 14px;
  font: inherit; font-size: 18px; color: inherit;
  background: var(--bg, #141816);
  border: 1px solid var(--border, var(--card-border, rgba(102, 137, 113, 0.35)));
  border-radius: 10px;
}
#ro-gate input:focus { outline: 2px solid var(--ro-gold, var(--gold, #e4aa4f)); outline-offset: 1px; }
#ro-gate button {
  min-height: 52px; padding: 12px 16px; border: 0; border-radius: 10px; cursor: pointer;
  font: inherit; font-size: 17px; font-weight: 700;
  background: var(--ro-gold, var(--gold, #e4aa4f)); color: #1a1a1a;
}
#ro-gate button:disabled { opacity: 0.6; cursor: progress; }
#ro-gate .ro-gate-error { min-height: 1.4em; color: var(--danger, var(--red, #c45c4a)); font-weight: 600; }
#ro-gate .ro-gate-wait[hidden] { display: none; }
/* Lock control: lives in the page's own chrome where it has a slot for it. */
#ro-gate-lock {
  margin: 0; cursor: pointer; font: inherit; color: inherit; background: none; border: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none;
}
#ro-gate-lock svg { width: 14px; height: 14px; flex: none; }
#ro-gate-lock:focus-visible { outline: 2px solid var(--ro-gold, var(--gold, #e4aa4f)); outline-offset: 2px; }
/* Hub rail footer: its own line under the connection status. */
#ro-gate-lock.ro-lock-rail { display: flex; margin-top: 10px; padding: 2px 0; font-size: 12px; }
#ro-gate-lock.ro-lock-rail:hover { color: var(--rail-ink, var(--text, #e8e4dc)); }
/* Sidebar footer (Wholesale, Complaints), end of the page (Supersack), floating fallback. */
#ro-gate-lock.ro-lock-side, #ro-gate-lock.ro-lock-end, #ro-gate-lock.ro-lock-float {
  color: var(--text-muted, var(--text-dim, #9aa59c));
  border: 1px solid var(--border, var(--card-border, rgba(102, 137, 113, 0.25)));
}
#ro-gate-lock.ro-lock-side { margin-left: auto; width: 32px; height: 32px; border-radius: 8px; }
#ro-gate-lock.ro-lock-end {
  display: flex; margin: 24px auto 4px; padding: 8px 14px; border-radius: 8px;
  font-family: var(--font-ui, system-ui, sans-serif); font-size: 13px; font-weight: 600;
}
#ro-gate-lock.ro-lock-float {
  position: fixed; left: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 9990;
  width: 32px; height: 32px; border-radius: 50%; opacity: 0.6;
  background: var(--bg-card, var(--card, rgba(26, 30, 27, 0.85)));
}
#ro-gate-lock.ro-lock-side:hover, #ro-gate-lock.ro-lock-end:hover, #ro-gate-lock.ro-lock-float:hover {
  color: var(--text, #e8e4dc); opacity: 1;
}
/* Icon-only variants keep the word for screen readers. */
#ro-gate-lock.ro-lock-side .ro-gate-lock-label, #ro-gate-lock.ro-lock-float .ro-gate-lock-label {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
}
@media print { #ro-gate-lock { display: none !important; } }
`;
  (document.head || root).appendChild(style);

  // 2. Hold API requests until unlock. The gate's own check uses nativeFetch.
  let unlocked = false;
  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function gatedFetch(input, init) {
    if (!unlocked && isApiUrl(input, location.href)) {
      return ready.then(() => nativeFetch(input, init));
    }
    return nativeFetch(input, init);
  };

  // -- Language ------------------------------------------------------------

  const STR = {
    en: {
      title: 'Locked',
      hint: 'Enter the shared password to open this page.',
      label: 'Password',
      submit: 'Unlock',
      checking: 'Checking…',
      waiting: 'Checking…',
      empty: 'Enter the password.',
      wrong: 'Wrong password',
      offline: 'Could not reach the server. Check the connection and try again.',
      lock: 'Lock',
      lockTitle: 'Lock this device (forget the password)',
    },
    es: {
      title: 'Bloqueado',
      hint: 'Escribe la contraseña compartida para abrir esta página.',
      label: 'Contraseña',
      submit: 'Desbloquear',
      checking: 'Verificando…',
      waiting: 'Comprobando…',
      empty: 'Escribe la contraseña.',
      wrong: 'Contraseña incorrecta',
      offline: 'No se pudo conectar con el servidor. Revisa la conexión e inténtalo de nuevo.',
      lock: 'Bloquear',
      lockTitle: 'Bloquear este dispositivo (olvidar la contraseña)',
    },
  };
  let lang = pickLang((k) => localStorage.getItem(k), pinnedLang);
  const txt = (k, sep = ' / ') => (lang === 'both' ? `${STR.en[k]}${sep}${STR.es[k]}` : STR[lang][k]);

  // -- UI ------------------------------------------------------------------

  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

  /** Run fn once <body> exists (the script itself runs while <head> parses). */
  function whenBody(fn) {
    if (document.body) { fn(); return; }
    let done = false;
    const once = () => {
      if (done || !document.body) return;
      done = true;
      mo.disconnect();
      fn();
    };
    const mo = new MutationObserver(once);
    mo.observe(root, { childList: true });
    document.addEventListener('DOMContentLoaded', once);
  }

  let gateEl = null;
  let busy = false;

  /** The opaque cover. Mounted at once; the form inside shows only on prompt. */
  function mountGate() {
    if (gateEl || unlocked) return;
    gateEl = document.createElement('div');
    gateEl.id = 'ro-gate';
    gateEl.setAttribute('role', 'dialog');
    gateEl.setAttribute('aria-modal', 'true');
    gateEl.setAttribute('aria-labelledby', 'ro-gate-title');
    gateEl.innerHTML =
      '<p class="ro-gate-wait" role="status" hidden></p>' +
      `<form novalidate hidden>${LOCK_SVG.replace('<svg', '<svg class="ro-gate-icon"')}` +
      '<h1 id="ro-gate-title"></h1><p class="ro-gate-hint"></p>' +
      '<label for="ro-gate-input"></label>' +
      '<input id="ro-gate-input" name="password" type="password" autocomplete="current-password" ' +
      'autocapitalize="off" autocorrect="off" spellcheck="false" autofocus>' +
      '<button type="submit"></button>' +
      '<p class="ro-gate-error" role="alert" aria-live="assertive"></p></form>';
    document.body.insertBefore(gateEl, document.body.firstChild);
    gateEl.querySelector('form').addEventListener('submit', onSubmit);
    paintGate();
  }

  function paintGate() {
    if (!gateEl) return;
    gateEl.querySelector('h1').textContent = txt('title', '\n');
    gateEl.querySelector('.ro-gate-hint').textContent = txt('hint', '\n');
    gateEl.querySelector('label').textContent = txt('label');
    const button = gateEl.querySelector('button');
    if (!busy) button.textContent = txt('submit');
    const wait = gateEl.querySelector('.ro-gate-wait');
    if (wait.textContent) wait.textContent = txt('waiting');
  }

  /** The quiet "Checking…" line on the cover while a slow stored-key check runs. */
  function showWaiting(on) {
    whenBody(() => {
      if (on) mountGate();
      if (!gateEl) return;
      const wait = gateEl.querySelector('.ro-gate-wait');
      wait.textContent = on ? txt('waiting') : '';
      wait.hidden = !on;
    });
  }

  function showPrompt() {
    whenBody(() => {
      mountGate();
      if (!gateEl) return;
      showWaiting(false);
      const form = gateEl.querySelector('form');
      form.hidden = false;
      const input = form.querySelector('input');
      input.value = '';
      input.focus();
    });
  }

  function showError(key) {
    if (!gateEl) return;
    gateEl.querySelector('.ro-gate-error').textContent = txt(key, '\n');
  }

  async function check(password, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await nativeFetch(VALIDATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ password }),
        signal: ctl ? ctl.signal : undefined,
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return classifyValidation({ ok: res.ok, status: res.status, body });
    } catch {
      return 'error'; // network failure or timeout
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const input = gateEl.querySelector('input');
    const button = gateEl.querySelector('button');
    const password = input.value;
    if (!password) { showError('empty'); input.focus(); return; }

    busy = true;
    button.disabled = true;
    button.textContent = txt('checking');
    showError('');
    const outcome = await check(password, TYPED_CHECK_MS);
    const next = afterTyped(outcome, outcome === 'ok' && store.set(PASSWORD_KEY, password));

    if (next === 'store-and-reload') {
      // Reload so every script on the page starts with the key in place, as on
      // a device that unlocked earlier (the Hub's cost lock and Wholesale's
      // write unlock read it at start-up). Requests held so far never fire.
      location.reload();
      return;
    }
    busy = false;
    button.disabled = false;
    button.textContent = txt('submit');
    if (next === 'reveal') {
      // localStorage is blocked: unlock this load only; it will ask again.
      reveal();
      return;
    }
    if (next === 'wrong') {
      input.value = ''; // so a retype cannot append to the bad one
      showError('wrong');
    } else {
      showError('offline');
    }
    input.focus();
  }

  /**
   * Put the Lock control in the page's own chrome so it covers nothing:
   *   .rail-foot      Hub rail footer, a text line under the status
   *   .sidebar-footer Wholesale / Complaints sidebar footer, icon only
   *   body > .main    Supersack pages, the last item of the main column (their
   *                   headers have no room for it at phone widths)
   * and only on a page with none of those, a small floating icon.
   */
  function mountLockButton() {
    if (document.getElementById('ro-gate-lock')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'ro-gate-lock';
    b.innerHTML = `${LOCK_SVG}<span class="ro-gate-lock-label"></span>`;
    b.addEventListener('click', lock);
    const rail = document.querySelector('.rail-foot');
    const side = !rail && document.querySelector('.sidebar-footer');
    const main = !rail && !side && document.querySelector('body > .main');
    if (rail) {
      b.className = 'ro-lock-rail';
      rail.appendChild(b);
    } else if (side) {
      b.className = 'ro-lock-side';
      side.appendChild(b);
    } else if (main) {
      b.className = 'ro-lock-end';
      main.appendChild(b);
    } else {
      b.className = 'ro-lock-float';
      document.body.appendChild(b);
    }
    paintLockButton();
  }

  function paintLockButton() {
    const b = document.getElementById('ro-gate-lock');
    if (!b) return;
    b.querySelector('.ro-gate-lock-label').textContent = txt('lock');
    b.title = txt('lockTitle');
    b.setAttribute('aria-label', txt('lockTitle'));
  }

  /** Run fn once the whole document is parsed, so the page's slots exist. */
  function whenParsed(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function reveal() {
    if (unlocked) return;
    unlocked = true;
    // Show the page before releasing the held requests, so they land on a
    // visible, laid-out page (charts size themselves when they render).
    root.classList.remove('ro-gated');
    whenBody(() => {
      if (gateEl) { gateEl.remove(); gateEl = null; }
    });
    whenParsed(mountLockButton);
    release();
  }

  /** Forget the password, tell the page, and re-gate it. */
  function lock() {
    store.remove(PASSWORD_KEY);
    // Dispatched on document (where the Hub listens) and bubbling, so window
    // listeners hear it too.
    document.dispatchEvent(new CustomEvent('ro:authchange', { bubbles: true, detail: { unlocked: false } }));
    location.reload();
  }

  // Follow the page's language toggle once it is open (unless the page pins it).
  document.addEventListener('ro:langchange', (e) => {
    const next = e && e.detail && e.detail.lang;
    if (pinnedLang || (next !== 'en' && next !== 'es')) return;
    lang = next;
    paintGate();
    paintLockButton();
  });

  // Another tab locked (key removed) or unlocked (key added): follow it.
  window.addEventListener('storage', (e) => {
    if (e.key !== PASSWORD_KEY && e.key !== null) return;
    const has = Boolean(store.get(PASSWORD_KEY));
    if (unlocked && !has) location.reload();
    else if (!unlocked && has && !busy) location.reload();
  });

  window.ROGate = {
    lock,
    isUnlocked: () => unlocked,
    ready, // resolves when the page is unlocked
  };

  // 3. Decide.
  whenBody(mountGate); // opaque cover while we decide, so nothing flashes
  const storedKey = store.get(PASSWORD_KEY);
  if (decideLoad(storedKey) === 'prompt') {
    showPrompt();
  } else {
    // A quick check shows a blank cover; only a slow one says "Checking…".
    const waitTimer = setTimeout(() => showWaiting(true), WAIT_HINT_MS);
    check(storedKey, STORED_CHECK_MS).then((outcome) => {
      clearTimeout(waitTimer);
      if (afterStoredCheck(outcome) === 'reveal') {
        reveal();
      } else {
        store.remove(PASSWORD_KEY);
        showPrompt();
      }
    });
  }
})();
