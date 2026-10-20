import test from 'node:test';
import assert from 'node:assert/strict';
import { cardTree, CANVAS, PLOT } from '../src/layout.js';
import { models, lockedModels, walk, findAll, textOf } from './helpers.mjs';

const ms = models();
const locked = lockedModels();
const trees = Object.fromEntries(Object.entries(ms).map(([name, m]) => [name, cardTree(m)]));
const role = (tree, r) => findAll(tree, (el) => el.props?.['data-role'] === r);
const kids = (el) => {
  const c = el.props.children;
  return c === undefined || c === null ? [] : Array.isArray(c) ? c : [c];
};

test('canvas is 1080x1350', () => assert.deepEqual(CANVAS, { width: 1080, height: 1350 }));

for (const [name, t] of Object.entries(trees)) {
  test(`${name}: root is 1080x1350 with the six sections in order`, () => {
    assert.equal(t.props.style.width, 1080);
    assert.equal(t.props.style.height, 1350);
    assert.deepEqual(kids(t).map((c) => c.props['data-section']), ['head', 'tiles', 'chart', 'minis', 'flags', 'foot']);
  });

  test(`${name}: every element with 2+ children is display flex`, () => {
    walk(t, (el) => {
      if (kids(el).length > 1) assert.equal(el.props.style?.display, 'flex', `${el.props['data-role'] || el.props['data-section'] || 'div'}: ${textOf(el).slice(0, 40)}`);
    });
  });

  test(`${name}: no NaN, undefined or null in any style value; only known fonts and weights`, () => {
    walk(t, (el) => {
      for (const [key, v] of Object.entries(el.props.style || {})) {
        assert.ok(v !== undefined && v !== null && !(typeof v === 'number' && !Number.isFinite(v)), `${key}=${v}`);
      }
      const s = el.props.style || {};
      if (s.fontFamily !== undefined) assert.ok(['Outfit', 'JetBrains Mono', 'DM Serif Display'].includes(s.fontFamily), s.fontFamily);
      if (s.fontWeight !== undefined) assert.ok([400, 500, 600].includes(s.fontWeight), String(s.fontWeight));
    });
  });

  test(`${name}: every text node has a font family and a px size`, () => {
    let texts = 0;
    walk(t, (el, inherited) => {
      for (const child of kids(el)) {
        if (typeof child !== 'string') continue;
        texts += 1;
        assert.ok(inherited.fontFamily, `no font for "${child}"`);
        assert.ok(Number.isFinite(inherited.fontSize) && inherited.fontSize > 0, `no size for "${child}"`);
      }
    });
    assert.ok(texts > 20);
  });

  test(`${name}: every child is a div or a clean string`, () => {
    walk(t, (el) => {
      for (const child of kids(el)) {
        if (typeof child === 'string') assert.ok(!/undefined|NaN|\[object/.test(child), child);
        else assert.ok(child && typeof child === 'object' && child.type === 'div', `bad child ${child}`);
      }
    });
  });

  test(`${name}: bars and ticks stay inside the plot`, () => {
    for (const bar of role(t, 'bar')) assert.ok(bar.props.style.height <= PLOT.height && bar.props.style.height > 0);
    for (const tick of role(t, 'tick')) assert.ok(tick.props.style.bottom + 3 <= PLOT.height && tick.props.style.bottom >= 0);
  });

  test(`${name}: the scale gives the tallest bar or tick 82% of the plot`, () => {
    const tops = role(t, 'col').map((col) => {
      const bar = kids(col).find((c) => c.props['data-role'] === 'bar');
      const tick = kids(col).find((c) => c.props['data-role'] === 'tick');
      return Math.max(bar ? bar.props.style.height : 0, tick ? tick.props.style.bottom : 0);
    });
    assert.ok(Math.abs(Math.max(...tops) - Math.round(PLOT.height * PLOT.headroom)) <= 1, String(Math.max(...tops)));
  });

  test(`${name}: one column, axis label and rate per chart column; caps sit above the bar and the tick`, () => {
    const cols = role(t, 'col');
    assert.equal(cols.length, ms[name].chart.cols.length);
    ms[name].chart.cols.forEach((c, i) => {
      const col = cols[i];
      assert.equal(col.props['data-kind'], c.kind);
      const bar = kids(col).find((k) => k.props['data-role'] === 'bar');
      const cap = kids(col).find((k) => k.props['data-role'] === 'cap');
      const tick = kids(col).find((k) => k.props['data-role'] === 'tick');
      assert.equal(Boolean(tick), c.target > 0, `tick on ${c.label}`);
      assert.ok(cap.props.style.bottom >= bar.props.style.height + 10, `cap over bar on ${c.label}`);
      if (tick && c.kind === 'bar') assert.ok(cap.props.style.bottom >= tick.props.style.bottom + 10, `cap over tick on ${c.label}`);
      if (c.kind === 'bar') assert.equal(textOf(cap), String(Math.round(c.lbs)));
    });
    const axis = role(t, 'axis');
    assert.deepEqual(axis.map((a) => textOf(kids(a)[0])), ms[name].chart.cols.map((c) => c.label));
    assert.deepEqual(axis.map((a) => textOf(kids(a)[1])), ms[name].chart.cols.map((c) => c.rate));
  });

  test(`${name}: tiles, minis, flags, head and foot carry the model text`, () => {
    const m = ms[name];
    const tiles = role(t, 'tile');
    assert.equal(tiles.length, 3);
    m.tiles.forEach((tile, i) => {
      const text = textOf(tiles[i]);
      for (const part of [tile.label, tile.value, tile.unit, ...tile.chips.map((c) => c.text)]) assert.ok(text.includes(part), `${part} in tile ${i}`);
    });
    const minis = role(t, 'mini');
    assert.equal(minis.length, 3);
    m.minis.forEach((mini, i) => {
      for (const part of [mini.label, mini.value, mini.unit, mini.sub]) assert.ok(textOf(minis[i]).includes(part), `${part} in mini ${i}`);
    });
    const flags = role(t, 'flag');
    assert.equal(flags.length, m.flags.length);
    m.flags.forEach((f, i) => {
      assert.ok(textOf(flags[i]).includes(f.text));
      assert.ok(textOf(flags[i]).includes(f.tag.toUpperCase()));
    });
    const head = kids(t)[0];
    for (const part of [m.eyebrow.toUpperCase(), m.title, m.sub, m.pill]) assert.ok(textOf(head).includes(part), part);
    assert.equal(textOf(kids(t)[5]), m.foot.left + m.foot.right);
  });

  test(`${name}: at most two chips per tile`, () => {
    for (const tile of role(t, 'tile')) assert.ok(role(tile, 'chip').length <= 2);
  });
}

test('chips never exceed two even when a model carries more', () => {
  const m = structuredClone(ms.weekly);
  m.tiles[0].chips.push({ kind: 'neutral', text: 'third' });
  const tile = role(cardTree(m), 'tile')[0];
  assert.equal(role(tile, 'chip').length, 2);
  assert.ok(!textOf(tile).includes('third'));
});

test('weekly bars are 72 px wide, hourly bars 48', () => {
  assert.ok(role(trees.weekly, 'bar').every((b) => b.props.style.width === 72));
  assert.ok(role(trees.eod, 'bar').every((b) => b.props.style.width === 48));
  assert.ok(role(trees.midday, 'bar').every((b) => b.props.style.width === 48));
});

test('an off column renders the stub and an "off" cap, with no tick', () => {
  const off = role(trees.weekly, 'col').find((c) => c.props['data-kind'] === 'off');
  const bar = kids(off).find((k) => k.props['data-role'] === 'bar');
  assert.equal(bar.props.style.height, 8);
  assert.equal(textOf(kids(off).find((k) => k.props['data-role'] === 'cap')), 'off');
  assert.ok(!kids(off).some((k) => k.props['data-role'] === 'tick'));
});

test('a now column renders a dashed box at the target height with no bottom border', () => {
  const now = role(trees.midday, 'col').find((c) => c.props['data-kind'] === 'now');
  const box = kids(now).find((k) => k.props['data-role'] === 'bar').props.style;
  const tick = kids(now).find((k) => k.props['data-role'] === 'tick').props.style;
  assert.equal(box.borderTopStyle, 'dashed');
  assert.equal(box.borderTopWidth, 2);
  assert.equal(box.borderBottomWidth, 0);
  assert.equal(box.borderTopColor, 'rgba(127,191,149,0.6)');
  assert.equal(box.backgroundColor, 'rgba(79,160,107,0.25)');
  assert.ok(Math.abs(box.height - tick.bottom) <= 1, `box ${box.height} vs tick ${tick.bottom}`);
  assert.equal(textOf(kids(now).find((k) => k.props['data-role'] === 'cap')), 'now');
});

test('ticks are 3 px dashed gold lines inset 10 px', () => {
  for (const tick of role(trees.eod, 'tick')) {
    const s = tick.props.style;
    assert.deepEqual([s.position, s.left, s.right, s.borderTopWidth, s.borderTopStyle, s.borderTopColor], ['absolute', 10, 10, 3, 'dashed', '#e4aa4f']);
  }
});

test('chip and flag colours follow their kind', () => {
  const chipStyle = (t, text) => role(t, 'chip').find((c) => textOf(c) === text).props.style;
  assert.deepEqual(
    [chipStyle(trees.weekly, '98% target').color, chipStyle(trees.weekly, '▲ +261% vs W41').color],
    ['#e4aa4f', '#7fbf95'],
  );
  const tones = role(trees.weekly, 'flag').map((f) => f.props.style.backgroundColor);
  assert.deepEqual(tones, ['rgba(224,123,107,0.14)', 'rgba(228,170,79,0.16)', 'rgba(127,191,149,0.14)']);
});

test('the title is DM Serif Display italic; numbers are Outfit 600', () => {
  const title = findAll(trees.weekly, (el) => el.props.children === 'Week 42')[0];
  assert.deepEqual([title.props.style.fontFamily, title.props.style.fontStyle], ['DM Serif Display', 'italic']);
  const num = findAll(trees.weekly, (el) => el.props.children === '497')[0];
  assert.deepEqual([num.props.style.fontSize, num.props.style.fontWeight], [76, 600]);
});

test('locked costs: the lock reads "locked" in the muted mono font, cost tiles have no chips', () => {
  const t = cardTree(locked.weekly);
  const tiles = role(t, 'tile');
  assert.equal(role(tiles[2], 'chip').length, 0);
  const locks = role(t, 'lock');
  assert.equal(locks.length, 2); // $/lb tops tile + labor mini
  for (const lock of locks) {
    assert.equal(textOf(lock), 'locked');
    assert.equal(lock.props.style.fontFamily, 'JetBrains Mono');
    assert.equal(lock.props.style.color, 'rgba(255,255,255,0.44)');
  }
  assert.ok(!textOf(t).includes('\u{1F512}'));
  assert.equal(textOf(role(t, 'mini')[2]), 'Laborlocked'); // the "locked" sub is not repeated under the lock
  assert.equal(textOf(role(t, 'mini')[0]), 'Smalls429lblocked');
});

test('a card with no flags still has an (empty) flags section', () => {
  const t = cardTree({ ...ms.eod, flags: [] });
  assert.equal(kids(t)[4].props['data-section'], 'flags');
  assert.equal(role(t, 'flag').length, 0);
});

test('cardTree leaves the model alone', () => {
  const m = structuredClone(ms.midday);
  cardTree(m);
  assert.deepEqual(m, ms.midday);
});
