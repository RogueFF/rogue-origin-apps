/**
 * Shared-password unlock. The key lives in localStorage under the same name
 * Wholesale and Consignment use, so unlocking once covers all three.
 */
import { validatePassword } from './api.js';

const KEY = 'ro_api_password';

export const hasKey = () => Boolean(localStorage.getItem(KEY));
export const forget = () => localStorage.removeItem(KEY);

let pending = null;

/** Open the unlock dialog. Resolves true once a password validates, false if dismissed. */
export function unlock() {
  if (pending) return pending;
  const dlg = document.getElementById('unlockDialog');
  const form = dlg.querySelector('form');
  const input = dlg.querySelector('input[type="password"]');
  const err = dlg.querySelector('.err');
  const submit = dlg.querySelector('button[value="ok"]');

  pending = new Promise((resolve) => {
    const cleanup = () => {
      form.removeEventListener('submit', onSubmit);
      dlg.removeEventListener('close', onClose);
      pending = null;
    };
    const onClose = () => { cleanup(); resolve(hasKey()); };
    const onSubmit = async (e) => {
      if (e.submitter?.value !== 'ok') return; // cancel button closes via method=dialog
      e.preventDefault();
      const pw = input.value;
      if (!pw) { err.textContent = 'Enter the shared password.'; return; }
      submit.disabled = true;
      err.textContent = '';
      const ok = await validatePassword(pw).catch(() => false);
      submit.disabled = false;
      if (ok) {
        localStorage.setItem(KEY, pw);
        dlg.close('ok');
      } else {
        err.textContent = 'That password did not match.';
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
