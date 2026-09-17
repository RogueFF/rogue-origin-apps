import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { handleHarvestD1 } from '../workers/src/handlers/harvest-d1.js';
import { practicePage } from '../workers/src/handlers/harvest-practice.js';
import { build } from 'esbuild';

// Wrangler uses keepNames. Exercise the serialized browser script after that
// transformation, since source-only tests cannot catch missing build helpers.
test('bundled practice tutorial works with Wrangler function-name preservation', async () => {
  const { outputFiles } = await build({
    entryPoints: ['workers/src/handlers/harvest-practice.js'],
    bundle: true, write: false, format: 'esm', platform: 'browser', keepNames: true,
  });
  const bundled = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
  const browser = await chromium.launch();
  try {
    for (const lang of ['en', 'es']) {
      const page = await browser.newPage();
      const errors = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => requests.push(r.url()));
      await page.setContent(await bundled.practicePage(lang).text());
      await page.locator('#tutorial-start').click();
      for (const action of ['scan', 'load', 'end', 'tag', 'open']) {
        await page.locator('#' + action).click();
        await page.locator('#tutorial-next').click();
      }
      await page.locator('#tutorial-next').click();
      assert.match(await page.locator('#tutorial h2').textContent(), /Tutorial (complete|terminado)/);
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('practice never accesses bindings or sets production cookies', async () => {
  const env = new Proxy({}, { get() { throw new Error('Practice accessed environment'); } });
  const r = await handleHarvestD1(new Request('https://practice.test/api/harvest?action=practice&lang=en'), env, {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match(r.headers.get('content-security-policy'), /connect-src 'none'/);
  assert.match(r.headers.get('content-security-policy'), /form-action 'none'/);
  const html = await r.text();
  assert.equal(/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon/.test(html), false);
});

test('full practice workflow is temporary, crew-specific and makes no API calls', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const requests = [], errors = [];
    page.on('request', r=>requests.push([r.method(),r.url()]));
    page.on('pageerror', e=>errors.push(e.message));
    await page.route('https://practice.test/**', async route=>{
      const r=practicePage('en');
      await route.fulfill({status:200,headers:Object.fromEntries(r.headers),body:await r.text()});
    });
    await page.goto('https://practice.test/api/harvest?action=practice');
    await page.locator('#scan').click();
    await page.locator('#crew').selectOption('B');
    await page.locator('#zone').selectOption('Z8');
    await page.locator('#scan').click();
    await page.locator('[data-step="1"]').click();
    assert.match(await page.locator('.practice-receipt').textContent(), /Z8/);
    await page.locator('#crew').selectOption('A');
    assert.match(await page.locator('.practice-receipt').textContent(), /Z4/);
    await page.locator('#load').click();
    await page.locator('#bins').fill('10');
    await page.locator('#load').click();
    assert.equal(await page.locator('#bins').inputValue(),'22');
    await page.locator('[data-step="2"]').click();
    await page.locator('#end').click();
    await page.locator('[data-step="3"]').click();
    await page.locator('#next-note').fill('Partial practice sack');
    await page.locator('#tag').click();
    await page.locator('#tag').click();
    await page.locator('#view-1').click();
    assert.match(await page.locator('#practice-app').textContent(),/Partial practice sack/);
    await page.locator('#move').selectOption('Bay 11');
    await page.locator('#move-save').click();
    await page.locator('#open').click();
    await page.locator('[data-step="5"]').click();
    assert.match(await page.locator('#practice-app').textContent(), /2 trailers · 32 bins/);
    assert.match(await page.locator('#practice-app').textContent(), /2 valid tags · 1 opened sacks/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.locator('#reset').click();
    await page.locator('[data-step="5"]').click();
    assert.match(await page.locator('#practice-app').textContent(), /0 trailers · 0 bins/);
    await page.reload();
    assert.equal(await page.locator('[aria-current=step]').textContent(),'1 · Crew & field');
    assert.deepEqual(errors,[]);
    assert.equal(requests.filter(([method,url])=>method!=='GET'||!url.includes('action=practice')).length,0);
  } finally { await browser.close(); }
});

test('Spanish practice renders every step',async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.setContent(await practicePage('es').text());
    for(let i=0;i<6;i++){
      await page.locator(`[data-step="${i}"]`).click();
      assert.equal(await page.locator('h1').count(),1);
    }
    assert.equal(await page.locator('html').getAttribute('lang'),'es');
  }finally{await browser.close()}
});

test('guided tutorial advances only after practice actions, in both languages', async () => {
  const browser=await chromium.launch();
  try {
    for(const lang of ['en','es']) {
      const page=await browser.newPage({viewport:{width:390,height:844}});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent(await practicePage(lang).text());
      await page.locator('#tutorial-start').click();
      for(const [i,action] of ['scan','load','end','tag','open'].entries()) {
        assert.equal(await page.locator('#tutorial-next').isDisabled(),true);
        await page.locator('#'+action).click();
        await page.waitForFunction(()=>!document.getElementById('tutorial-next').disabled);
        await page.locator('#tutorial-next').click();
        assert.match(await page.locator('.tutorial-progress').textContent(),new RegExp((i+2)+' / 6'));
      }
      await page.locator('#tutorial-next').click();
      assert.equal(await page.locator('#tutorial-start').count(),1);
      assert.match(await page.locator('#tutorial h2').textContent(),/Tutorial (complete|terminado)/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
      await page.close();
    }
  }finally{await browser.close()}
});
