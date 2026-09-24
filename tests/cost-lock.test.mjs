import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripCosts, lockCosts } from '../workers/src/lib/cost-lock.js';

const env = { API_PASSWORD: 'open-sesame' };
const payload = {
  today: { tops: 120.5, laborCost: 1500, costPerLb: 12.4, topsCostPerLb: 11.1, operatorHours: 8, trimmerHours: 40 },
  daily: [
    { date: '2026-09-23', totalTops: 100, laborCost: 900, smallsCostPerLb: 3.2, trimmerHours: 30 },
  ],
  strainSnapshot: [{ strain: 'Lifter', tops: 50, topsCostPerLb: 9.9, avgRate: 1.1 }],
  summary: { totalLaborCost: 4000, blendedCostPerLb: 8, avgRate: 1.2 },
};

describe('stripCosts', () => {
  it('removes every key containing "cost" at any depth', () => {
    const out = stripCosts(payload);
    assert.deepEqual(out, {
      today: { tops: 120.5, operatorHours: 8, trimmerHours: 40 },
      daily: [{ date: '2026-09-23', totalTops: 100, trimmerHours: 30 }],
      strainSnapshot: [{ strain: 'Lifter', tops: 50, avgRate: 1.1 }],
      summary: { avgRate: 1.2 },
    });
  });

  it('does not mutate the input and passes primitives through', () => {
    const before = JSON.stringify(payload);
    stripCosts(payload);
    assert.equal(JSON.stringify(payload), before);
    assert.equal(stripCosts(null), null);
    assert.equal(stripCosts(7), 7);
  });
});

const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Test': '1' } });

describe('lockCosts', () => {
  it('strips costs and flags the payload for callers without the password', async () => {
    const req = new Request('https://x/api/production?action=dashboard');
    const res = await lockCosts(json(payload), req, {}, env);
    const out = await res.json();
    assert.equal(out.costsLocked, true);
    assert.equal(out.today.laborCost, undefined);
    assert.equal(out.today.tops, 120.5);
    assert.equal(res.headers.get('X-Test'), '1');
  });

  it('strips costs when the password is wrong', async () => {
    const req = new Request('https://x/api/production?action=dashboard', { headers: { Authorization: 'Bearer nope' } });
    const out = await (await lockCosts(json(payload), req, {}, env)).json();
    assert.equal(out.costsLocked, true);
    assert.equal(out.daily[0].laborCost, undefined);
  });

  it('returns the response untouched with the right password in the header', async () => {
    const req = new Request('https://x/api/production?action=dashboard', { headers: { Authorization: 'Bearer open-sesame' } });
    const out = await (await lockCosts(json(payload), req, {}, env)).json();
    assert.equal(out.costsLocked, undefined);
    assert.equal(out.today.laborCost, 1500);
  });

  it('accepts the password in a POST body too', async () => {
    const req = new Request('https://x/api/production?action=dashboard', { method: 'POST' });
    const out = await (await lockCosts(json(payload), req, { password: 'open-sesame' }, env)).json();
    assert.equal(out.summary.totalLaborCost, 4000);
  });

  it('leaves error responses alone', async () => {
    const req = new Request('https://x/api/production?action=dashboard');
    const res = await lockCosts(new Response('{"error":"x"}', { status: 500 }), req, {}, env);
    assert.equal(res.status, 500);
    assert.equal(await res.text(), '{"error":"x"}');
  });
});
