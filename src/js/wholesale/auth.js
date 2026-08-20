/**
 * Wholesale order board — write unlock.
 *
 * Reads on this page are public; only writes are gated. So rather than blocking
 * the whole page behind a login the way Consignment does, the board loads and
 * the password is asked for at the moment it is first needed.
 *
 * The password is validated against /api/orders?action=validatePassword — the
 * same endpoint Consignment uses, and the reason that route survived the app
 * retirement — then stored under the shared `ro_api_password` key so unlocking
 * once covers every write-capable page in the hub.
 */

import { t } from '../shared/i18n.js';
import { API_ROOT } from '../shared/api.js';

const KEY = 'ro_api_password';
const $ = (id) => document.getElementById(id);

export const hasPassword = () => Boolean(localStorage.getItem(KEY));

export function forgetPassword() {
  localStorage.removeItem(KEY);
}

/**
 * Resolve true once a valid password is stored, false if the operator cancels.
 * Returns immediately when one is already held.
 */
export function ensureUnlocked() {
  if (hasPassword()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const modal = $('unlock-modal');
    const input = $('u-password');
    const error = $('u-error');
    const save = $('u-save');
    const cancel = $('u-cancel');

    input.value = '';
    error.textContent = '';
    modal.hidden = false;
    input.focus();

    const done = (ok) => {
      modal.hidden = true;
      save.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      resolve(ok);
    };

    const attempt = async () => {
      const password = input.value;
      if (!password) { error.textContent = t('err_password'); return; }

      save.disabled = true;
      error.textContent = '';
      try {
        const res = await fetch(`${API_ROOT}/orders?action=validatePassword`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ password }),
        });
        const raw = await res.json();
        const result = raw.data || raw;

        if (res.ok && result.success) {
          localStorage.setItem(KEY, password);
          done(true);
        } else {
          // Clear the field on a bad password so a retype cannot append.
          error.textContent = result.error || t('err_password_bad');
          input.value = '';
          input.focus();
        }
      } catch {
        error.textContent = t('err_connection');
      } finally {
        save.disabled = false;
      }
    };

    save.onclick = attempt;
    cancel.onclick = () => done(false);
    input.onkeydown = (e) => { if (e.key === 'Enter') attempt(); };
  });
}
