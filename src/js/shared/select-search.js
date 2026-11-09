/**
 * Type-to-search over an existing <select> (Koa 2026-11-09: "type a few letters
 * and the list filters"). The <select> stays the source of truth: the page keeps
 * filling its options and setting its value, and still gets a 'change' event when
 * someone picks. This only puts a text box and a list of big buttons in front of it.
 *
 *   enhanceSelect(selectEl, { placeholder: () => 'Type to search' })
 *
 * Matching ignores case, accents and a leading "2026 - " crop prefix, and every
 * typed word has to appear somewhere ("sour lif" finds "2026 - Sour Lifter / Sungrown").
 * Enter picks the first match; Escape or a tap outside closes it unchanged.
 */

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const bare = s => fold(s).replace(/^\d{4}\s*-\s*/, '');

export function matches(text, query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = `${bare(text)} ${fold(text)}`;
  return words.every(w => hay.includes(w));
}

let styled = false;
function addStyles() {
  if (styled) return;
  styled = true;
  const css = document.createElement('style');
  css.textContent = `
.ss-wrap { position: relative; }
.ss-wrap > select.ss-hidden { position: absolute; opacity: 0; pointer-events: none; width: 1px; height: 1px; }
.ss-input { width: 100%; box-sizing: border-box; }
.ss-list { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 30; max-height: min(52vh, 420px); overflow-y: auto;
  background: var(--bg-card, #fff); border: 2px solid var(--border-strong, #999); border-radius: 12px; box-shadow: 0 10px 28px rgba(0,0,0,.25);
  padding: 4px; display: grid; gap: 4px; }
.ss-list[hidden] { display: none; }
.ss-opt { min-height: 56px; text-align: left; font: 600 20px var(--font-ui, system-ui); color: var(--text, #111); background: var(--bg, #fafafa);
  border: 1px solid var(--border, #ddd); border-radius: 10px; padding: 8px 12px; cursor: pointer; }
.ss-opt.on { border-color: var(--green, #3d6b45); background: var(--green-dim, #e3efe5); }
.ss-opt:active { transform: scale(.99); }
.ss-none { padding: 12px; color: var(--text-secondary, #666); font-size: 17px; }`;
  document.head.appendChild(css);
}

export function enhanceSelect(select, { placeholder = () => '' } = {}) {
  addStyles();
  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('ss-hidden');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = `${select.className.replace(/\bss-hidden\b/, '')} ss-input`.trim();
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.enterKeyHint = 'done';
  const list = document.createElement('div');
  list.className = 'ss-list';
  list.hidden = true;
  list.setAttribute('role', 'listbox');
  wrap.append(input, list);

  const options = () => [...select.options];
  const current = () => select.options[select.selectedIndex];
  let open = false;

  // What the box shows while closed: the chosen option's text (the first,
  // empty option is a prompt like "Choose the cultivar", shown greyed).
  function showValue() {
    const o = current();
    input.value = o && o.value !== '' ? o.text : '';
    input.placeholder = o && o.value === '' ? o.text : placeholder();
    // Mirror the select's state classes (e.g. 'missing') onto the box.
    input.className = `${select.className.replace(/\bss-hidden\b/, '')} ss-input`.trim();
  }

  function render(query) {
    list.innerHTML = '';
    // No query: every option, the empty first one included ("Same as the room" is a
    // real choice on the hourly log). With a query: only real options that match.
    const shown = query ? options().filter(o => o.value !== '' && matches(o.text, query)) : options();
    if (!shown.length) {
      const none = document.createElement('div');
      none.className = 'ss-none';
      none.textContent = '—';
      list.appendChild(none);
    }
    for (const o of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ss-opt' + (o.value === select.value ? ' on' : '');
      b.textContent = o.text;
      b.setAttribute('role', 'option');
      // pointerdown, not click: picking must happen before the box loses focus.
      b.addEventListener('pointerdown', e => { e.preventDefault(); pick(o.value); });
      list.appendChild(b);
    }
    return shown;
  }

  // On focus the box empties so typing starts fresh; when typing opens it, the
  // letters already typed stay.
  function openList(keepText = false) {
    open = true;
    if (!keepText) input.value = '';
    input.placeholder = placeholder();
    render(input.value.trim());
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close() {
    open = false;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    showValue();
  }
  function pick(value) {
    const changed = select.value !== value;
    select.value = value;
    close();
    input.blur();   // drops the on-screen keyboard
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('focus', () => openList());
  input.addEventListener('input', () => { if (!open) openList(true); else render(input.value.trim()); });
  input.addEventListener('blur', () => { if (open) close(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = render(input.value.trim())[0];
      if (first) pick(first.value); else close();
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });

  // The page rebuilds the options and sets the value whenever it renders.
  new MutationObserver(() => { if (!open) showValue(); })
    .observe(select, { childList: true, attributes: true, attributeFilter: ['class', 'disabled'] });
  select.addEventListener('change', () => { if (!open) showValue(); });
  showValue();
  return { refresh: showValue, input };
}
