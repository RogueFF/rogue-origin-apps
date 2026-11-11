// Bag labels behind a switch (src/js/print/labels.mjs, order flow slice 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bagLabels, labelSheetHtml } from '../src/js/print/labels.mjs';

test('one label per bag, flower lines only, cultivar text only', () => {
  const lines = [
    { cultivar: 'Sour Lifter', form: 'tops', bag: 'oz1', qty: 3 },
    { cultivar: 'Rainbow GMO', form: 'smalls', bag: 'qOz', qty: 1 },
    { cultivar: null, title: 'Hemp Pre-Rolls', form: null, qty: 2 },
  ];
  assert.deepEqual(bagLabels(lines), ['Sour Lifter', 'Sour Lifter', 'Sour Lifter', 'Rainbow GMO']);
  assert.deepEqual(bagLabels([]), []);
});

test('the sheet: a 1 x 4.75 in page per label, text escaped, nothing else on it', () => {
  const html = labelSheetHtml(['Peyton\'s <Strawberries>', 'Lifter']);
  assert.match(html, /@page \{ size: 1in 4\.75in; margin: 0; \}/);
  assert.equal((html.match(/<section class="l">/g) || []).length, 2);
  assert.ok(html.includes('Peyton&#39;s &lt;Strawberries&gt;'));
  assert.ok(!/THC|lot|COA/i.test(html.replace(/<title>.*?<\/title>/, '')), 'cultivar text only');
});
