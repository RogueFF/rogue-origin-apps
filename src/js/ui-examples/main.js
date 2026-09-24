/**
 * UI examples page: mounts the shell with the language switch on, and wires
 * the demo controls for status and the unlock dialog.
 */
import { mountShell, setStatus } from '../../shell/shell.js';
import { unlock, forget, hasKey } from '../../shell/unlock.js';

const $ = (id) => document.getElementById(id);

mountShell({ brand: 'UI examples', start: [$('topbarStart')], lang: true });
setStatus('idle', 'Examples');

document.querySelectorAll('[data-status]').forEach((btn) => {
  btn.addEventListener('click', () => setStatus(btn.dataset.status, btn.textContent));
});

document.querySelectorAll('#topbarStart .chip').forEach((chip, _i, chips) => {
  chip.addEventListener('click', () => chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip))));
});

const paintKey = () => { $('keyState').textContent = hasKey() ? 'Unlocked on this device.' : 'Locked.'; };
$('unlockBtn').addEventListener('click', async () => { await unlock(); paintKey(); });
$('forgetBtn').addEventListener('click', () => { forget(); paintKey(); });
paintKey();
