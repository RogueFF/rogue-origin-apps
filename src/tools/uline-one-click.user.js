// ==UserScript==
// @name         Rogue Origin · one-click carts (Uline, Amazon)
// @namespace    https://rogueff.github.io/rogue-origin-apps/
// @version      1.1.0
// @description  When the Supply Kanban desk opens a vendor page with a list in the URL, fill the cart. Uline: paste into Quick Order and Add to Cart. Amazon: walk the product pages, set each quantity, add, then open the cart. Does nothing without a list from the desk.
// @author       Rogue Origin
// @match        https://www.uline.com/QuickOrder*
// @match        https://www.amazon.com/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://rogueff.github.io/rogue-origin-apps/src/tools/uline-one-click.user.js
// @downloadURL  https://rogueff.github.io/rogue-origin-apps/src/tools/uline-one-click.user.js
// ==/UserScript==

(function () {
  'use strict';
  var host = location.hostname;

  function listFromHash(pattern) {
    var m = location.hash.match(/ro=([^&]+)/); if (!m) return null;
    var text; try { text = decodeURIComponent(m[1]); } catch (_e) { return null; }
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length || !lines.every(function (l) { return pattern.test(l); })) return null;
    return lines;
  }

  // ---------- Uline: Quick Order → Paste Items → Add to Cart ----------
  if (host === 'www.uline.com') {
    var lines = listFromHash(/^[A-Z]{1,3}-[A-Z0-9-]{1,24} \d{1,6}$/i); if (!lines) return;
    var tries = 0;
    var go = function () {
      var ta = document.getElementById('txtPaste'), btn = document.getElementById('btnAddPastedItemsToCart'), mode = document.getElementById('IsPasteMode');
      if (!ta || !btn) return false;
      try { if (window.PageScript && window.PageScript.ShowPaste) window.PageScript.ShowPaste(); } catch (_e) { /* the paste section is still fillable */ }
      ta.value = lines.join('\n'); ta.classList.remove('empty');
      ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true }));
      if (mode) mode.value = 'True';
      history.replaceState(null, '', location.pathname); // a reload must not add the items twice
      setTimeout(function () { btn.click(); }, 400);
      return true;
    };
    if (!go()) { var iv = setInterval(function () { if (go() || ++tries > 40) clearInterval(iv); }, 250); }
    return;
  }

  // ---------- Amazon: one product page at a time ----------
  if (host === 'www.amazon.com') {
    var KEY = 'ro-amz-queue';
    var read = function () { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (_e) { return null; } };
    var write = function (q) { try { if (q) sessionStorage.setItem(KEY, JSON.stringify(q)); else sessionStorage.removeItem(KEY); } catch (_e) { /* no session storage: give up quietly */ } };
    var asinHere = function () { var m = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/); return m ? m[1] : null; };

    // 1. A fresh list from the desk starts a queue (and a fresh list always replaces an old one).
    var fresh = listFromHash(/^[A-Z0-9]{10} \d{1,6}$/);
    if (fresh) {
      write({ items: fresh.map(function (l) { var p = l.split(' '); return { asin: p[0], qty: parseInt(p[1], 10) }; }), adding: null, added: [], notes: [], started: Date.now() });
      history.replaceState(null, '', location.pathname);
    }
    var q = read(); if (!q) return;
    if (Date.now() - q.started > 20 * 60 * 1000) { write(null); return; } // a stale queue never fires on a later visit

    var next = function () {
      if (!q.items.length) { write(null); location.assign('https://www.amazon.com/gp/cart/view.html'); return; }
      q.adding = q.items[0].asin; write(q);
      location.assign('https://www.amazon.com/dp/' + q.items[0].asin);
    };

    // 2. We arrived somewhere after clicking Add to Cart → that item is done, move on.
    if (q.adding && asinHere() !== q.adding) {
      q.added.push(q.adding); q.items = q.items.filter(function (i) { return i.asin !== q.adding; }); q.adding = null; write(q);
      setTimeout(next, 800);
      return;
    }

    // 3. On the product page of the current item: set the quantity and add.
    var cur = q.items[0]; if (!cur || asinHere() !== cur.asin) { if (cur && !q.adding) next(); return; }
    var attempts = 0;
    var add = function () {
      var btn = document.getElementById('add-to-cart-button'); var sel = document.getElementById('quantity');
      if (!btn) return false;
      if (sel) {
        var want = String(cur.qty); var has = Array.prototype.some.call(sel.options, function (o) { return o.value === want; });
        if (has) { sel.value = want; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        else { var max = sel.options[sel.options.length - 1]; if (max && /^\d+$/.test(max.value)) { sel.value = max.value; sel.dispatchEvent(new Event('change', { bubbles: true })); } q.notes.push(cur.asin + ': wanted ' + want + ', page allows ' + (max ? max.value : '?')); }
      } else if (cur.qty > 1) { q.notes.push(cur.asin + ': no quantity box, added 1'); }
      q.adding = cur.asin; write(q);
      setTimeout(function () {
        btn.click();
        // Some pages add without leaving the page (a side panel confirms): watch for it, then move on ourselves.
        var t0 = Date.now(); var poll = setInterval(function () {
          var ok = document.querySelector('#attach-added-to-cart-message, #NATC_SMART_WAGON_CONF_MSG_SUCCESS, #huc-v2-order-row-confirm-text, #sw-atc-details-single-container');
          if (ok || Date.now() - t0 > 8000) { clearInterval(poll); if (ok) { q.added.push(cur.asin); q.items.shift(); q.adding = null; write(q); next(); } }
        }, 400);
      }, 600);
      return true;
    };
    if (!add()) { var iv2 = setInterval(function () { if (add() || ++attempts > 40) clearInterval(iv2); }, 250); }
  }
})();
