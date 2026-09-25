import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getLoadedLaborRate, BASE_WAGE_RATE } from '../workers/src/lib/production-utils.js';

// Mock a D1 env whose system_config table holds the given key->value rows.
function mockEnv(rows) {
  return {
    DB: {
      prepare(sql) {
        return {
          bind(key) {
            return { async first() {
              if (!(key in rows)) return null;
              return { value: String(rows[key]), value_type: 'number' };
            } };
          },
        };
      },
    },
  };
}

describe('getLoadedLaborRate', () => {
  it('computes wage * (1 + tax) from D1 config', async () => {
    const rate = await getLoadedLaborRate(mockEnv({ 'labor.base_wage_rate': 23, 'labor.employer_tax_rate': 0.14 }));
    assert.equal(Math.round(rate * 100) / 100, 26.22);
  });

  it('falls back to the neutral 0 wage when the config row is missing', async () => {
    const rate = await getLoadedLaborRate(mockEnv({ 'labor.employer_tax_rate': 0.14 }));
    assert.equal(rate, 0);
  });
});

describe('public-repo wage disclosure guard', () => {
  it('does not hard-code a real base wage in source', () => {
    assert.equal(BASE_WAGE_RATE, 0, 'BASE_WAGE_RATE must stay 0 in the public repo; real wage lives in D1 config');
    const src = readFileSync(new URL('../workers/src/lib/production-utils.js', import.meta.url), 'utf8');
    assert.ok(!/BASE_WAGE_RATE\s*=\s*(?!0\b)\d/.test(src), 'no numeric wage literal assigned to BASE_WAGE_RATE');
  });
});
