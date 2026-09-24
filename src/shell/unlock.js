/**
 * Shared-password unlock, owned by the shell. The key lives in localStorage
 * under the name Wholesale and Consignment use, so unlocking once covers every
 * screen. The dialog builds itself on first use; pages carry no markup for it.
 *
 * The dialog speaks the page's language: Spanish when <html lang="es"> (set by
 * the shell's language switch), English otherwise.
 */
import { API_ROOT } from '../js/shared/api.js';
import { label } from './labels.js';

const KEY = 'ro_api_password';

export const hasKey = () => Boolean(localStorage.getItem(KEY));
export const forget = () => localStorage.removeItem(KEY);

/** True when the Worker accepts the shared password. */
export async function validatePassword(password) {
  const res = await fetch(`${API_ROOT}/orders?action=validatePassword`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ password }),
  });
  let raw = {};
  try { raw = await res.json(); } catch { /* non-JSON body */ }
  const result = raw.data || raw;
  return Boolean(res.ok && result.success);
}

function buildDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'unlock';
  dlg.id = 'unlockDialog';
  dlg.setAttribute('aria-labelledby', 'unlockTitle');
  dlg.innerHTML = '<form method="dialog">'
    + '<h3 id="unlockTitle"></h3>'
    + '<p></p>'
    + '<input type="password" name="password" autocomplete="current-password">'
    + '<div class="err" aria-live="polite"></div>'
    + '<div class="row"><button class="tb-btn" value="cancel" type="submit" formnovalidate></button><button class="tb-btn primary" value="ok" type="submit"></button></div>'
    + '</form>';
  document.body.append(dlg);
  return dlg;
}

let pending = null;

/**
 * Open the unlock dialog. Resolves true once a password validates, false if
 * dismissed. `reason` replaces the default sentence explaining why it is asked.
 */
export function unlock({ reason } = {}) {
  if (pending) return pending;
  const dlg = document.getElementById('unlockDialog') || buildDialog();
  const form = dlg.querySelector('form');
  const input = dlg.querySelector('input[type="password"]');
  const err = dlg.querySelector('.err');
  const cancel = dlg.querySelector('button[value="cancel"]');
  const submit = dlg.querySelector('button[value="ok"]');

  const L = (key) => label(document.documentElement.lang === 'es' ? 'es' : 'en', key);
  dlg.querySelector('h3').textContent = L('unlock.title');
  dlg.querySelector('p').textContent = reason || L('unlock.reason');
  input.placeholder = L('unlock.placeholder');
  input.setAttribute('aria-label', L('unlock.inputLabel'));
  cancel.textContent = L('unlock.cancel');
  submit.textContent = L('unlock.submit');

  pending = new Promise((resolve) => {
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      pending = null;
    };
    const onClose = () => { cleanup(); resolve(hasKey()); };
    const onSubmit = async (e) => {
      if (e.submitter?.value !== 'ok') return; // cancel closes via method=dialog
      e.preventDefault();
      const pw = input.value;
      if (!pw) { err.textContent = L('unlock.empty'); return; }
      submit.disabled = true;
      err.textContent = '';
      const ok = await validatePassword(pw).catch(() => false);
      submit.disabled = false;
      if (ok) {
        localStorage.setItem(KEY, pw);
        dlg.close('ok');
      } else {
        err.textContent = L('unlock.wrong');
        input.value = '';
        input.focus();
      }
    };
    form.addEventListener('submit', onSubmit);
    dlg.addEventListener('close', onClose);
    input.value = '';
    err.textContent = '';
    dlg.showModal();
    input.focus();
  });
  return pending;
}
