/** Small UI helpers: toast, a form dialog (never window.confirm/prompt), error card. */
import { t } from '../shared/i18n.js';
import { esc } from './format.js';

let toastTimer = null;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `cs-toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'cs-toast'; }, 4000);
}

function fieldHtml(f, i) {
  const id = `dlg-f${i}`;
  const req = f.required ? ' required' : '';
  if (f.type === 'checkbox') {
    return `<label class="cs-check"><input type="checkbox" id="${id}" name="${esc(f.name)}"${f.value ? ' checked' : ''}> <span>${esc(f.label)}</span></label>`;
  }
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${esc(f.name)}" class="cs-input">${f.options.map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${esc(f.name)}" class="cs-input" rows="2"${req}>${esc(f.value ?? '')}</textarea>`;
  } else {
    const type = f.type === 'number' ? 'text' : (f.type || 'text');
    const mode = f.type === 'number' ? ' inputmode="decimal"' : '';
    input = `<input id="${id}" name="${esc(f.name)}" type="${type}"${mode} class="cs-input${f.type === 'number' ? ' cs-num' : ''}" value="${esc(f.value ?? '')}" autocomplete="off"${req}>`;
  }
  return `<label class="cs-field" for="${id}"><span class="cs-label">${esc(f.label)}</span>${input}</label>`;
}

/**
 * A modal form. Resolves with {name: value} on OK, or null on Cancel.
 * Fields: {name, label, type: text|number|date|select|checkbox|textarea, value, options, required}.
 * message: optional plain text under the title (a confirm with no fields).
 */
export function dialog({ title, message = '', fields = [], okLabel, danger = false }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'cs-dialog';
    dlg.innerHTML = `<form method="dialog" class="cs-dialog-form" novalidate>
      <h2>${esc(title)}</h2>
      ${message ? `<p class="cs-dlgmsg">${esc(message)}</p>` : ''}
      ${fields.map(fieldHtml).join('')}
      <p class="cs-error" hidden></p>
      <div class="cs-row-btns">
        <button type="button" class="cs-btn ghost" data-act="cancel">${esc(t('cancel'))}</button>
        <button type="submit" class="cs-btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(okLabel || t('ok'))}</button>
      </div>
    </form>`;
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const el = form.elements[f.name];
        out[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
        if (f.required && f.type !== 'checkbox' && !out[f.name]) {
          const err = dlg.querySelector('.cs-error');
          err.textContent = `${f.label}: ${t('required')}`;
          err.hidden = false;
          el.focus();
          return;
        }
      }
      done(out);
    });
    dlg.showModal();
    const first = form.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) first.focus();
  });
}

/** A card that says what failed and offers a retry. Never a blank page. */
export function errorCard(root, err, retry) {
  root.innerHTML = `<section class="cs-card cs-errcard"><p>${esc(t('errGeneric'))}</p><p class="cs-muted">${esc(err && err.network ? t('errOffline') : (err && err.message) || '')}</p><button type="button" class="cs-btn primary">${esc(t('retry'))}</button></section>`;
  root.querySelector('button').addEventListener('click', retry);
}

export const loading = (root) => { root.innerHTML = `<p class="cs-muted cs-loading">${esc(t('loading'))}</p>`; };
