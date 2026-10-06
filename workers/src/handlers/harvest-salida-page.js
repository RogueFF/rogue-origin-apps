/**
 * The water spider's scan-out screen (/salida). Design §4:
 * docs/plans/2026-10-06-sack-scan-out-design.md. Camera, typed number and a
 * handheld scanner all reach the same `sack_out` call; the page is the light
 * harvest-screen theme, phone-first, two columns on a desktop.
 *
 * Every server/QR string reaches the DOM through textContent in the client;
 * the server-rendered markup below holds only our own strings (escaped
 * anyway) and boot travels as escaped JSON in a non-executable script tag.
 */
import { LOGIC_SOURCE, escapeHtml, embedJson } from './harvest-salida-logic.js';
import { SALIDA_STRINGS } from './harvest-salida-strings.js';
import { salidaMain } from './harvest-salida-client.js';
import { SALIDA_DECODER_PATH } from './harvest-salida-decoder.js';

export const WHOLESALE_QUEUE_URL = 'https://rogueff.github.io/rogue-origin-apps/src/pages/wholesale.html';

const STYLE = `
/* renderPage wraps us in .harvest-screen (light theme + header); widen it for the two-column desk view and trim the phone gutter to 16px. */
.harvest-screen:has(.salida){max-width:1200px;padding:0 16px 40px}
/* The station desktop is a big monitor read from a step back. Everything on
   this screen is sized in px for the phone, so on a wide viewport the whole
   tool scales up as one block (zoom), and the two columns get room to match. */
@media(min-width:1400px){.harvest-screen:has(.salida){max-width:1500px}.salida{zoom:1.2}}
@media(min-width:1900px){.harvest-screen:has(.salida){max-width:1900px}.salida{zoom:1.4}}
.salida{padding:0 0 40px;font-family:Karla,system-ui,sans-serif;color:#263f32}
.salida *{box-sizing:border-box}
.salida h1{font:700 26px/1.1 Karla,system-ui,sans-serif;margin:4px 0 2px}
.salida .hint{color:#60715d;margin:0 0 10px}
.salida .testflag{background:#c45c4a;color:#fff;font-weight:800;text-align:center;padding:10px;border-radius:9px;margin-bottom:10px;font-size:18px}
.salida .cols{display:grid;gap:18px;grid-template-columns:minmax(0,1fr)}
.salida .cols>div{min-width:0}
@media(min-width:900px){.salida .cols{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.salida #scam{position:relative;border-radius:12px;overflow:hidden;background:#000;aspect-ratio:4/3;max-height:34vh;width:100%}
.salida .aim{position:absolute;inset:14% 26%;border:4px solid rgba(255,255,255,.9);border-radius:14px;box-shadow:0 0 0 999px rgba(0,0,0,.28);pointer-events:none}
.salida .camstat{position:absolute;left:8px;top:8px;margin:0;padding:4px 10px;border-radius:99px;background:rgba(0,0,0,.6);color:#fff;font-size:15px}
.salida .sbanner{background:#fff3d1;border:2px solid #e4aa4f;color:#5a3d06;font-weight:800;border-radius:10px;padding:10px 12px;margin:0 0 10px;font-size:18px}
.salida video{width:100%;height:100%;object-fit:cover;display:block}
.salida .camtools{position:absolute;right:8px;bottom:8px;display:flex;gap:8px}
.salida button{min-height:56px;min-width:56px;border-radius:10px;border:1px solid #c4d0ba;background:#edf1e4;color:#304e3c;font:700 20px Karla,system-ui,sans-serif;cursor:pointer}
.salida button:focus-visible,.salida input:focus-visible{outline:4px solid #e4aa4f;outline-offset:2px}
.salida .sfb{min-height:86px;border-radius:12px;padding:14px;margin:12px 0;font-size:clamp(24px,5vw,34px);font-weight:800;line-height:1.15;background:#fff;border:2px solid #d9dfd1;display:flex;gap:12px;align-items:center}
.salida #sfbicon{font-size:1.2em;flex:none}
.salida .sfb.idle{background:#f6f5ef;color:#304e3c;border:2px dashed #a9b99f;font-size:clamp(19px,4.4vw,24px);font-weight:700}
.salida .sfb.wait{background:#edf1e4;color:#304e3c;border-color:#668971}
.salida .sfb.ok{background:#2f7a46;color:#fff;border-color:#2f7a46}
.salida .sfb.warn,.salida .sfb.pick{background:#e4aa4f;color:#1b2b20;border-color:#e4aa4f}
.salida .sfb.bad{background:#c45c4a;color:#fff;border-color:#c45c4a}
.salida .big{display:block;width:100%;margin-top:8px;font-size:26px;min-height:72px}
.salida .chips,.salida .sorders{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.salida .chip{padding:6px 14px;display:inline-flex;align-items:center;gap:8px;text-align:left;max-width:100%}
.salida .chip small{font:600 13px ui-monospace,Menlo,monospace;color:#60715d}
.salida .chip em{font-style:normal;font-size:14px;background:#fff;border:1px solid #c4d0ba;border-radius:99px;padding:1px 8px;color:#304e3c}
.salida #schips{flex-wrap:nowrap;overflow-x:auto;scroll-snap-type:x proximity;padding:3px}.salida #schips .chip{flex:none}
.salida #snum::placeholder{font:600 22px Karla,system-ui,sans-serif;color:#8a9a86}
.salida .chip.on{background:#304e3c;color:#fff;border-color:#304e3c;box-shadow:0 0 0 3px #e4aa4f}
.salida .chip.on small{color:#e9f0e2}
.salida .undo{width:100%;min-height:72px;font-size:28px;background:#304e3c;color:#fff;margin-top:8px}
.salida #snum{width:100%;min-height:72px;font:800 44px/1 ui-monospace,Menlo,monospace;text-align:center;border:2px solid #bcc9b2;border-radius:10px}
.salida #spad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.salida #spad button{min-height:56px;font-size:28px}
.salida #spad .go{grid-column:span 3;background:#304e3c;color:#fff;min-height:68px;font-size:30px}
.salida .sgroup{background:#fff;border:1px solid #d9dfd1;border-radius:10px;padding:10px 12px;margin-bottom:10px}
.salida .sgroup.pending{border-style:dashed;border-color:#e4aa4f}
.salida .sgroup h3{display:flex;align-items:baseline;gap:8px;margin:0 0 6px;font-size:18px;flex-wrap:wrap}
.salida .sgroup h3 b{font-size:21px;color:#304e3c}.salida .sgroup h3 small{color:#60715d;font-weight:600}.salida .sgroup h3 span{margin-left:auto}
.salida .sbar{height:6px;background:#eef1e8;border-radius:99px;overflow:hidden;margin:0 0 6px}.salida .sbar i{display:block;height:100%;background:#668971}
.salida .srow{display:grid;grid-template-columns:4em 3.5em minmax(0,1fr) 5.5em auto;align-items:center;gap:6px;font-size:17px;padding:2px 0;border-top:1px solid #eef1e8}
.salida .rowundo{min-height:56px;font-size:16px;padding:0 10px;white-space:nowrap}
.salida .rowundo.arm{background:#c45c4a;color:#fff;border-color:#c45c4a}
.salida .queue{display:inline-flex;align-items:center;min-height:56px;color:#304e3c;font-weight:700}
.salida #ssimbox input{width:100%;min-height:48px;font-size:16px}
body.flash-ok{animation:sflash-ok .5s} body.flash-warn{animation:sflash-warn .5s} body.flash-bad{animation:sflash-bad .7s}
@keyframes sflash-ok{0%{background:#4fbf6f}} @keyframes sflash-warn{0%{background:#f2c46b}} @keyframes sflash-bad{0%{background:#e0705c}}
@media(prefers-reduced-motion:reduce){.salida *{transition:none!important;animation:none!important}body.flash-ok,body.flash-warn,body.flash-bad{animation:none}}
`;

export function salidaPageBody(ui, boot) {
  const b = boot && typeof boot === 'object' ? boot : {};
  const lang = (ui && ui.lang) === 'en' || b.lang === 'en' ? 'en' : 'es';
  const S = SALIDA_STRINGS[lang];
  const e = (k) => escapeHtml(S[k]);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'clr'];
  const pad = keys.map((k) => k === 'del' ? `<button type="button" data-k="del" aria-label="${e('clear')}">⌫</button>`
    : k === 'clr' ? `<button type="button" data-k="clr" aria-label="${e('clr')}">C</button>` : `<button type="button" data-k="${k}">${k}</button>`).join('');
  return `<style>${STYLE}</style>
<div class="salida">
  ${b.is_test ? `<div class="testflag">${e('test')}</div>` : ''}
  <div id="sbanner" class="sbanner" role="status" hidden></div>
  <h1>${e('title')}</h1>
  <p class="hint">${e('scanHint')}</p>
  <div class="cols">
    <div>
      <div id="scam" hidden><video id="svideo" playsinline muted autoplay></video><div class="aim" aria-hidden="true"></div><p id="sstat" class="camstat" aria-live="polite"></p>
        <div class="camtools"><button type="button" id="storch" hidden>🔦 ${e('torch')}</button></div></div>
      <div id="snocam" hidden><p class="hint">${e('noCam')} <span id="snocamwhy"></span></p><button type="button" id="sretry" class="big">📷 ${e('retryCam')}</button></div>
      <div id="sfb" class="sfb" role="status" aria-live="assertive"><span id="sfbicon" aria-hidden="true"></span><span id="sfbline"></span></div>
      <div id="spick"></div>
      <div id="slast" hidden></div>
      <div id="ssimbox" hidden><input id="ssim" placeholder="sim: tag URL / id" autocomplete="off"></div>
      <div class="chips" id="schips" role="group" aria-label="${e('pickCultivar')}"></div>
      <input id="snum" inputmode="numeric" pattern="[0-9]*" autocomplete="off" aria-label="${e('number')}" placeholder="${e('number')}">
      <div id="spad">${pad}<button type="button" class="go" data-k="go">${e('go')}</button></div>
    </div>
    <div>
      <h2>${e('today')}</h2>
      <div id="slist"></div>
      <a class="queue" href="${WHOLESALE_QUEUE_URL}">${e('queue')} →</a>
    </div>
  </div>
</div>
<script type="application/json" id="salida-boot">${embedJson({ boot: b, S })}</script>
<script>
${LOGIC_SOURCE}
(${salidaMain.toString()})((function () { var d = JSON.parse(document.getElementById('salida-boot').textContent); return d.boot || {}; })(),
  JSON.parse(document.getElementById('salida-boot').textContent).S, ${JSON.stringify(SALIDA_DECODER_PATH)});
</script>`;
}
