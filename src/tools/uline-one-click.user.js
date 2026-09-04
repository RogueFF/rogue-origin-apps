// ==UserScript==
// @name         Rogue Origin · Uline one-click cart
// @namespace    https://rogueff.github.io/rogue-origin-apps/
// @version      1.0.0
// @description  When the Supply Kanban desk opens uline.com/QuickOrder with a list in the URL, paste it and add it to the cart. Does nothing on any other page or without a list.
// @author       Rogue Origin
// @match        https://www.uline.com/QuickOrder*
// @run-at       document-idle
// @grant        none
// @updateURL    https://rogueff.github.io/rogue-origin-apps/src/tools/uline-one-click.user.js
// @downloadURL  https://rogueff.github.io/rogue-origin-apps/src/tools/uline-one-click.user.js
// ==/UserScript==

(function () {
  'use strict';
  var m = location.hash.match(/ro=([^&]+)/); if (!m) return;
  var text;
  try { text = decodeURIComponent(m[1]); } catch (_e) { return; }
  // Only ever paste lines that look like "MODEL QTY" — never arbitrary text from a URL.
  var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
  if (!lines.length || !lines.every(function (l) { return /^[A-Z]{1,3}-[A-Z0-9-]{1,24} \d{1,6}$/i.test(l); })) return;
  var tries = 0;
  function go() {
    var ta = document.getElementById('txtPaste'), btn = document.getElementById('btnAddPastedItemsToCart'), mode = document.getElementById('IsPasteMode');
    if (!ta || !btn) return false;
    try { if (window.PageScript && window.PageScript.ShowPaste) window.PageScript.ShowPaste(); } catch (_e) { /* the paste section is still fillable */ }
    ta.value = lines.join('\n'); ta.classList.remove('empty');
    ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new Event('change', { bubbles: true }));
    if (mode) mode.value = 'True';
    history.replaceState(null, '', location.pathname); // a reload must not add the items twice
    setTimeout(function () { btn.click(); }, 400);
    return true;
  }
  if (!go()) { var iv = setInterval(function () { if (go() || ++tries > 40) clearInterval(iv); }, 250); }
})();
