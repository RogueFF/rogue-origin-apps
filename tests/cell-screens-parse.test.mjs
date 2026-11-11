// The cell screens must parse. A stray quote in a label once stopped cell.html
// from starting at all (2026-11-10: "basket's" inside a single-quoted string),
// which on the floor means no job recorded. Each entry module is checked as an
// ES module with node --check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCREENS = ['src/js/cell/main.js', 'src/js/cells/main.js', 'src/js/cell/lift.mjs', 'src/js/cell/breaks.mjs', 'src/js/cell-hourly/main.js', 'src/js/rawout/main.js', 'src/js/rawout/rates.mjs', 'src/js/bagtag/main.js', 'src/js/bagtag/view.mjs'];

test('every cell screen module parses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cell-parse-'));
  try {
    for (const f of SCREENS) {
      const copy = join(dir, f.replace(/[\\/]/g, '_').replace(/\.js$/, '.mjs'));
      copyFileSync(f, copy);
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' }), `${f} does not parse`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
