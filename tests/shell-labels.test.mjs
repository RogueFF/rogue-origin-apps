/**
 * Shell strings, pinned: every English string has a Spanish one, every app and
 * group in the rail is named in both languages, and the rail only carries
 * translation hooks on pages that turned the language switch on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { NAV, railHtml } from '../src/shell/nav.js';
import { SHELL_LABELS, label } from '../src/shell/labels.js';

test('every English shell string has a non-empty Spanish string', () => {
  for (const key of Object.keys(SHELL_LABELS.en)) {
    assert.ok(SHELL_LABELS.es[key], `missing es: ${key}`);
  }
  for (const key of Object.keys(SHELL_LABELS.es)) {
    assert.ok(key in SHELL_LABELS.en, `es-only key: ${key}`);
  }
});

test('every rail group and app is named in both languages', () => {
  for (const group of NAV) {
    assert.equal(SHELL_LABELS.en[`shell.group.${group.id}`], group.group);
    assert.ok(SHELL_LABELS.es[`shell.group.${group.id}`]);
    for (const item of group.items) {
      assert.equal(SHELL_LABELS.en[`shell.nav.${item.id}`], item.label);
      assert.ok(SHELL_LABELS.es[`shell.nav.${item.id}`], item.id);
    }
  }
});

test('label falls back to English, then to the key', () => {
  assert.equal(label('es', 'unlock.title'), 'Desbloquear');
  assert.equal(label('fr', 'unlock.title'), 'Unlock');
  assert.equal(label('en', 'no.such.key'), 'no.such.key');
});

test('the language button always names the other language', () => {
  assert.equal(label('en', 'shell.langButton'), 'ES');
  assert.equal(label('es', 'shell.langButton'), 'EN');
});

test('railHtml carries translation hooks only when asked', () => {
  const plain = railHtml('hub');
  assert.doesNotMatch(plain, /data-i18n/);
  const hooked = railHtml('hub', { i18n: true });
  const items = NAV.flatMap((group) => group.items);
  assert.equal((hooked.match(/data-i18n="shell\.nav\./g) || []).length, items.length);
  assert.equal((hooked.match(/data-i18n="shell\.group\./g) || []).length, NAV.length);
});
