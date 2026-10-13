import { IFRAME_PRINT_UNRELIABLE_SRC } from '../lib/print-client.js';

/** Shared working-screen theme. Print sheets and sack labels keep their geometry. */
export const HARVEST_UI_STYLE = `
[hidden]{display:none!important}
body:has(.harvest-screen){padding:0;background:#f6f5ef;color:#263f32}
body:has(.harvest-screen)>.lang{display:none}
body:has(.harvest-screen)>.testband{margin:0}
.harvest-screen{max-width:960px;padding:0 28px 40px;margin:auto;font-family:Karla,system-ui,sans-serif}
.harvest-screen *{box-sizing:border-box}
.harvest-header{display:flex;align-items:center;gap:14px;padding:22px 0;margin-bottom:30px;border-bottom:1px solid #d9dfd1}
.harvest-header img{width:54px;height:54px;object-fit:contain}
.harvest-header strong{display:block;font-size:14px;letter-spacing:.1em}
.harvest-header small{color:#5a6b57;font-size:13px}
.harvest-header nav{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.harvest-header a{color:#304e3c;text-decoration:none;border:1px solid #c6d0bc;border-radius:24px;padding:11px 15px;font-size:14px;min-height:44px;display:flex;align-items:center}
.harvest-screen h1{font:700 clamp(30px,4vw,42px)/1.12 Karla,system-ui,sans-serif;letter-spacing:-.035em;margin-bottom:14px}
.harvest-screen h2{font:700 21px/1.25 Karla,system-ui,sans-serif;letter-spacing:-.02em;text-transform:none;color:#304e3c;margin:26px 0 14px}
.harvest-screen :is(.sub,.hint,.lot-meta,.lotmeta,.batch,.last){color:#60715d}
.harvest-screen .sub{font-size:16px;line-height:1.6;margin-bottom:24px}
.harvest-screen .note{color:#40543f;line-height:1.6;font-size:16px}
.harvest-screen .hint{font-size:14px;line-height:1.6}
.harvest-screen form:not(.finishrow):not(.finishlot){padding:24px;background:#fff;border:1px solid #d9dfd1;border-radius:14px;margin:20px 0}
.harvest-screen label{color:#304e3c;font-weight:700;font-size:16px}
.harvest-screen :is(input,select,textarea){color:#263f32;background:white;border:1px solid #bcc9b2;border-radius:8px;font:16px system-ui,sans-serif;min-height:50px;padding:12px;width:100%}
.harvest-screen input[type=radio]{width:20px;height:20px;min-height:20px;flex:none;transform:none}
.harvest-screen textarea{resize:vertical}
.harvest-screen .btn,.harvest-screen .bigbtn{background:#304e3c;border:1px solid #304e3c;border-radius:9px;color:white;font:700 18px Karla,system-ui,sans-serif;min-height:54px;cursor:pointer}
.harvest-screen .btn:hover,.harvest-screen .bigbtn:hover{background:#43634a}
.harvest-screen .btn.alt{background:#edf1e4;color:#304e3c;border-color:#c0cfb5}
.harvest-screen button:disabled{opacity:.6;cursor:wait}
.harvest-screen .grid a.btn{background:#edf1e4;color:#304e3c;border-color:#c4d0ba;min-height:70px;font-size:26px}
.harvest-screen .grid a.btn.sel{background:#edc76b;color:#263f32;box-shadow:none;border-color:#af882f}
.harvest-screen .hcstat.ok{color:#315e37}.harvest-screen .hcstat.bad{color:#9a3d32}
.harvest-screen .lotlist{gap:12px}
.harvest-screen label.lot{background:#fff;color:#263f32;border-color:#cbd5c0;padding:20px}
.harvest-screen label.lot:has(input:checked){background:#edf2e4;border-color:#7f9b68}
.harvest-screen label.lot.green{opacity:1}
.harvest-screen .badge{border-radius:20px;font-size:12px;padding:6px 10px}
.harvest-screen .badge.ok{background:#e5eddb;color:#345c38}
.harvest-screen .badge.warn{background:#f8ebcb;color:#77511a}
.harvest-screen .badge.bad{background:#f4e0d8;color:#954431}
.harvest-screen .baybig,.harvest-screen .baypill{background:#f8ebcb;color:#5b3d0e}
.harvest-screen .zchip{background:#edf1e5;color:#263f32;border:1px solid #d9dfd1}
.harvest-screen .zchip b{color:#77511a}
.harvest-screen .lot:not(label){padding:24px;background:#668971;color:#fff;border:0;border-radius:15px}
.harvest-screen .lot:not(label) .lot-meta{color:#fff;font-size:15px;line-height:1.6}
.harvest-screen .lot-cultivar{font-size:30px}
.harvest-screen #printBtn{background:#edc76b;color:#263f32;border-color:#edc76b;min-height:120px;font-size:30px}
.harvest-screen .status{padding:22px;background:#fff;border:1px solid #d9dfd1;border-radius:12px}
.harvest-screen .mini{min-height:44px;background:#edf1e4;color:#304e3c;border:1px solid #c2cdb8}
.harvest-screen .mini.danger{background:#fff;color:#994837;border-color:#d7b2a4}
.harvest-screen :is(.nextnote,.batch,.finished,details) summary{min-height:48px;display:flex;align-items:center;font-size:16px}
.harvest-screen .nextnote{color:#304e3c}.harvest-screen .nextnote.pending summary{color:#825b14}
.harvest-screen .notice{background:#f8edcf;color:#77511a;border-color:#d7b574}
.harvest-screen .flash{background:#e8efdd;color:#365b36;border-color:#abc093}
.harvest-screen .finishrow{background:#fff;border-color:#d9dfd1;align-items:center;flex-wrap:wrap}
.harvest-screen form.finishrow.done{background:#f3f5ef;color:#263f32}
.harvest-screen .tagrow{background:#fff;color:#263f32;border-color:#d9dfd1}
.harvest-screen .tagrow.voided{background:#f3f5ef;opacity:.75}
.harvest-screen .tagrow .tagwhen{color:#60715d}
.harvest-screen .footer{padding-top:22px;border-top:1px solid #d9dfd1;font-size:14px;line-height:2}
.harvest-screen .footer a{color:#42623e;display:inline-block;min-height:44px;padding:4px 0}
.harvest-screen .cvgrid a{background:white;color:#304e3c;border:1px solid #d4ddcb;text-align:left}
.harvest-screen .crew-stepper.big input{font-size:30px;font-weight:700}
.hourly-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
.hourly-log{width:100%;border-collapse:collapse;margin:10px 0 4px;font-size:14px;white-space:nowrap}
.hourly-log th{text-align:left;font-size:12px;color:#5d6f57;font-weight:700;padding:6px 8px;border-bottom:1px solid #d5dfd4}
.hourly-log td{padding:8px;border-bottom:1px solid #e6ebe1}
.hourly-log tr:nth-child(even) td{background:#f4f7f0}
.hourly-log td.sticks{font-weight:700;font-size:16px;color:#2e4b3b}
.harvest-screen .cvgrid a.sel{background:#edc76b;border-color:#af882f}
.harvest-screen .cvfix{margin:20px 0 4px}.harvest-screen .cutfix form{margin:8px 0}.harvest-screen .cutfix button{width:100%;min-height:56px}
.harvest-screen .cvfix summary{min-height:44px;padding:11px 0;color:#42623e;font-weight:600;cursor:pointer}
.harvest-screen #intakeForm{max-width:680px}.harvest-screen #intakeForm button{width:100%;min-height:76px;background:#edc76b;color:#263f32;border-color:#d9b259}
.harvest-screen #intakeReceipt:not(:empty){padding:20px;background:#e9efdf;border:1px solid #c4d2b5;border-radius:12px;margin:18px 0}
/* Trailer decal screen (/t/<n>): one hand, one phone, gloves. Every choice is a big radio tile. */
.harvest-screen h1.trailer-name{font-size:64px;line-height:1;margin:4px 0 6px;letter-spacing:-.02em}
.harvest-screen .trailer-lot{margin:14px 0}.harvest-screen .trailer-lot .lotmeta strong{font-size:24px;line-height:1.25;color:#263f32}
.harvest-screen .note.warn{padding:14px 16px;background:#fff4d6;border:2px solid #d9a93a;border-radius:12px;color:#4a3a12;font-weight:600}
.harvest-screen #trailerForm{max-width:680px}
.harvest-screen #trailerForm button[type=submit]{width:100%;min-height:84px;font-size:22px;background:#edc76b;color:#263f32;border-color:#d9b259;margin-top:18px}
.harvest-screen .baybarn{font-size:14px;font-weight:700;color:#55664c;margin:12px 0 6px;text-transform:uppercase;letter-spacing:.06em}
.harvest-screen .baygrid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.harvest-screen .baybtn{position:relative;display:block}
.harvest-screen .baybtn input{position:absolute;opacity:0;inset:0;margin:0}
.harvest-screen .baybtn span{display:grid;place-items:center;min-height:64px;border:2px solid #c5d1b9;border-radius:12px;background:#fff;font-size:26px;font-weight:800;color:#304e3c}
.harvest-screen .baybtn input:checked+span{background:#304e3c;border-color:#304e3c;color:#fff}
.harvest-screen .baybtn input:focus-visible+span{box-shadow:0 0 0 3px #9ba98c}
.harvest-screen .lotother{margin:10px 0 4px;border:0;padding:0}
.harvest-screen .lotother summary,.harvest-screen .partial summary{min-height:44px;padding:11px 0;color:#42623e;font-weight:600;cursor:pointer}
.harvest-screen .lotother legend{font-weight:700;margin-bottom:8px}
.harvest-screen .choice{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;margin:8px 0;border:2px solid #d9dfd1;border-radius:12px;background:#fff;font-size:17px}
.harvest-screen .choice input{width:24px;height:24px;margin:0;flex:none}
.harvest-screen .choice:has(input:checked){border-color:#304e3c;background:#edf1e4}
.harvest-screen .partial{margin-top:14px}
.harvest-screen .home-add{margin-top:22px}.harvest-screen .a2hs{margin:18px 0 8px}.harvest-screen .a2hs-how{background:#1f3527;border-radius:10px;padding:12px 14px;margin-top:10px;font-size:1.05rem}.harvest-screen .a2hs-how.ios .a2hs-android,.harvest-screen .a2hs-how.android .a2hs-ios{display:none}.harvest-screen .launch-btn{min-height:120px;font-size:28px}.harvest-screen .again{margin:16px 0 8px}.harvest-screen .again-btn{width:100%;min-height:84px;font-size:24px;font-weight:800;background:#2f7a4f;color:#fff;border-color:#2f7a4f}.harvest-screen .again-btn:disabled{opacity:.45}.harvest-screen .again .hint{text-align:center;margin:6px 0 0}
.logged-flash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:#fff;background:#2f7a4f;cursor:pointer;animation:lfIn .18s ease-out}.logged-flash.out{opacity:0;transition:opacity .45s ease}.logged-flash .lf-mark{width:min(48vw,230px);height:min(48vw,230px)}.logged-flash .lf-mark circle{fill:none;stroke:rgba(255,255,255,.35);stroke-width:3}.logged-flash .lf-mark path{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:50;stroke-dashoffset:50;animation:lfDraw .45s .15s ease-out forwards}.logged-flash .lf-big{font-size:clamp(40px,13vw,64px);font-weight:900;line-height:1}.logged-flash .lf-sub{font-size:clamp(22px,7vw,32px);font-weight:800}.logged-flash .lf-lot{font-size:clamp(16px,5vw,22px);opacity:.92}@keyframes lfIn{from{opacity:0;transform:scale(1.04)}to{opacity:1;transform:none}}@keyframes lfDraw{to{stroke-dashoffset:0}}@media (prefers-reduced-motion:reduce){.logged-flash,.logged-flash .lf-mark path{animation:none}.logged-flash .lf-mark path{stroke-dashoffset:0}}
.harvest-screen .baybig{font-size:44px;font-weight:800;line-height:1.1;color:#304e3c;margin-top:6px}
.harvest-screen .fixload{margin:18px 0 6px}
.harvest-screen .fixload>summary{display:block;min-height:52px;padding:14px 16px;border:2px solid #c5d1b9;border-radius:12px;background:#fff;color:#304e3c;font-weight:700;cursor:pointer;list-style:none}
.harvest-screen .fixload>summary::-webkit-details-marker{display:none}
.harvest-screen .fixload[open]>summary{margin-bottom:12px}
.harvest-screen #trailerFix button[type=submit]{width:100%;min-height:64px;margin-top:14px}
.harvest-screen form.undo button,.harvest-screen form.newload button{width:100%;min-height:56px;margin-top:12px}
.harvest-screen #intakeActive{margin-bottom:14px;font-size:17px;font-weight:600}
.harvest-screen #followOpen{font-size:14px;min-height:44px}
.harvest-screen .reconcile-table{overflow:auto}.harvest-screen table{border-collapse:collapse;width:100%;font-size:15px;white-space:nowrap}
.harvest-screen td,.harvest-screen th{text-align:left;padding:15px 12px;border-bottom:1px solid #d7dfcd}
.harvest-screen th{font-size:12px;color:#60715d}
.harvest-screen .crew-stepper{display:flex;align-items:center;gap:10px;margin:8px 0 20px}
.harvest-screen .crew-stepper input{margin:0;max-width:100px;text-align:center}
.harvest-screen .crew-stepper button{min-width:50px;min-height:50px;border:1px solid #c5d1b9;border-radius:8px;background:#e9eedf;color:#304e3c;font-size:26px}
.harvest-screen .crew-A{--crew:#2f7a4f;--crew-soft:#e3f0e6}.harvest-screen .crew-B{--crew:#2f6596;--crew-soft:#e2ecf6}.harvest-screen .crew-C{--crew:#a35a1c;--crew-soft:#f6e8da}
.harvest-screen .crewgrid{display:grid;gap:14px;margin:8px 0 16px}
.harvest-screen a.crewbtn{display:flex;align-items:center;gap:20px;min-height:96px;padding:16px 22px;text-decoration:none;text-align:left;background:var(--crew);border-color:var(--crew);font-size:28px}
.harvest-screen a.crewbtn:hover{background:var(--crew);filter:brightness(1.1)}
.harvest-screen .crewletter{flex:none;display:grid;place-items:center;width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,.22);font-size:34px;font-weight:800}
.harvest-screen .crewlead{font-weight:800}
.harvest-screen .trgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 22px}
.harvest-screen label.trtile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:76px;border:2px solid #c5d1b9;border-radius:12px;background:#fff;cursor:pointer}
.harvest-screen label.trtile input{position:absolute;opacity:0;inset:0;margin:0;width:100%;height:100%;cursor:pointer}
.harvest-screen label.trtile .trname{font-size:28px;font-weight:800;color:#304e3c}
.harvest-screen label.trtile .trwith{font-size:13px;font-weight:600;color:#8a6a1c}
.harvest-screen label.trtile:has(input:checked){background:#304e3c;border-color:#304e3c}
.harvest-screen label.trtile:has(input:checked) :is(.trname,.trwith){color:#fff}
.harvest-screen label.trtile:has(input:focus-visible){box-shadow:0 0 0 3px #9ba98c}
.harvest-screen label.countrow{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 12px;font-size:20px}
.harvest-screen label.countrow input{max-width:110px;min-height:60px;text-align:center;font-size:26px;font-weight:800;margin:0}
.harvest-screen form:has(.trgrid) button[type=submit]{width:100%;min-height:76px;font-size:22px;margin-top:12px}
.harvest-screen .cntgrid{grid-template-columns:repeat(5,minmax(0,1fr))}
.harvest-screen .crewcard{border:2px solid var(--crew);border-left-width:10px;background:var(--crew-soft);border-radius:12px;padding:16px 18px;margin:18px 0}
.harvest-screen .crewcard-head{font-size:22px;font-weight:800;color:var(--crew);margin-bottom:8px}
.harvest-screen .crewcard-tr{font-size:18px;margin-bottom:6px}
.harvest-screen .crewcard-n{display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:14px;color:#40543f;font-size:16px}
.harvest-screen .crewcard-n strong{font-size:22px;color:#263f32}
.harvest-screen .crewcard a.mini{display:inline-flex;align-items:center;min-height:48px;padding:10px 16px;border-radius:9px;background:#fff;border:1px solid #c0cfb5;color:#304e3c;font-weight:700;text-decoration:none}
/* Tags by bay (bay_tags): bays as drawers, a PRINT per cultivar. Scoped to its own classes. */
.harvest-screen .baydrawer{background:#fff;border:1px solid #d9dfd1;border-radius:14px;margin:12px 0;padding:0 14px}
.harvest-screen .baydrawer>summary{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;min-height:64px;padding:10px 0;list-style:none;cursor:pointer}
.harvest-screen .baydrawer>summary::-webkit-details-marker{display:none}
.harvest-screen .baydrawer>summary .baybig{font-size:30px;margin:0;padding:2px 12px;border-radius:9px}
.harvest-screen .baydrawer>summary .lotmeta{flex:1 1 auto;font-size:15px}
.harvest-screen .baydrawer[open]>summary{border-bottom:1px solid #e3e8dc;margin-bottom:10px}
.harvest-screen .baydrawer.finished{background:#f3f5ef;opacity:.75}
.harvest-screen .storagechip{margin-left:auto;padding:6px 12px;border-radius:20px;background:#edf1e4;border:1px solid #c0cfb5;color:#304e3c;font-size:14px;font-weight:700;white-space:nowrap}
.harvest-screen .lasttag{font-size:15px;color:#40543f;margin:4px 0 10px;overflow-wrap:anywhere}
.harvest-screen .cvrow{display:flex;flex-direction:column;gap:8px;padding:12px;margin:10px 0;border:1px solid #d9dfd1;border-radius:12px;background:#fbfcf8}
.harvest-screen .cvname{display:block;width:100%;text-align:left;background:none;border:0;padding:4px 0;color:#263f32;font:inherit;cursor:pointer;min-height:44px}
.harvest-screen .cvname>b{display:block;font-size:20px}
.harvest-screen .cvname .zonemix{margin-top:4px}
.harvest-screen .printbtn{width:100%;min-height:72px;font-size:22px;background:#edc76b;color:#263f32;border-color:#d9b259;overflow-wrap:anywhere}
.harvest-screen .printbtn:hover{background:#e3bb57}
.harvest-screen .cvdrawer{display:flex;flex-direction:column;gap:8px;padding-top:6px}
.harvest-screen .cvdrawer .batchrow{display:flex;gap:8px}.harvest-screen .cvdrawer .batchrow input{max-width:110px}
.harvest-screen .noloads{display:block;font-size:13px;color:#7a6a3c;font-style:italic}
.harvest-screen .addcv{width:100%;margin:6px 0}
.harvest-screen .baydrawer .finishlot{margin:6px 0 14px}.harvest-screen .baydrawer .finishlot button{width:100%}
.harvest-screen #lastMsg{position:sticky;top:0;z-index:5;box-shadow:0 2px 8px rgba(38,63,50,.15)}
.harvest-screen .flash.bad{background:#f4e0d8;color:#954431;border-color:#d7b2a4}
.harvest-screen .storagechip{cursor:pointer;min-height:36px;display:inline-flex;align-items:center}
.harvest-screen dialog{border:1px solid #d9dfd1;border-radius:14px;padding:20px;width:min(92vw,420px);color:#263f32;background:#fff}
.harvest-screen dialog::backdrop{background:rgba(38,63,50,.45)}
.harvest-screen dialog h2{margin-top:0}
.harvest-screen dialog .batchrow{display:flex;gap:8px;margin-top:14px}.harvest-screen dialog .batchrow button{flex:1}
.harvest-screen #addZones .zpick{min-height:48px;padding:10px 18px;margin:10px 8px 0 0;font-size:18px;font-weight:700;border-radius:10px;cursor:pointer}
.harvest-screen #addZones .zpick.sel{background:#304e3c;color:#fff;border-color:#304e3c}
.harvest-screen :is(button,a,input,select,textarea,summary):focus-visible{outline:3px solid #9c7423;outline-offset:3px}
@media(min-width:900px){.harvest-screen:has(#intakeForm),.harvest-screen:has(.crew-stepper),.harvest-screen:has(.grid),.harvest-screen:has(#printBtn){max-width:800px}}
@media(max-width:600px){.harvest-screen{padding:0 16px 30px}.harvest-header{gap:8px}.harvest-header img{width:42px;height:42px}.harvest-header strong{font-size:13px}.harvest-header small{display:none}.harvest-header nav{gap:4px}.harvest-header a{padding:11px 12px;font-size:14px}.harvest-screen form:not(.finishrow):not(.finishlot){padding:18px}.harvest-screen .lothead{font-size:17px}.harvest-screen .lastActions{flex-wrap:wrap}}
@media(max-width:700px){body.testmode:has(.sd)>.testband{margin-left:-18px;margin-right:-18px}}
@media print{.harvest-header{display:none}}
`;

export const OFFICE_UI_STYLE = `
:root{--bg:#f6f5ef;--panel:#fff;--raised:#edf1e5;--line:#d9dfd1;--line2:#becdb2;--ink:#263f32;--ink2:#455b43;--muted:#5e7159;--leaf:#4d7a48;--straw:#96721e;--clay:#a26932;--sky:#47708a;--plum:#885c92;--bad:#9f4837;--ok:#3e773f}
.split>*{min-width:0}svg{max-width:100%}.rack.vacant,.bay.empty{opacity:1;background:var(--bg)}.rack.vacant .bn{color:var(--muted)}.k-tag{background:#f4e7c8;color:#76561d}.testpill{background:#f4e7c8;color:#76561d;border-color:#c6a964}details>summary{cursor:pointer;font-weight:700;padding:18px 0}details>summary:focus-visible{outline:3px solid #997223}
body{font-family:Karla,system-ui,sans-serif}.wrap{padding-top:24px}h1{font-size:36px;letter-spacing:-.04em}.card{border-radius:15px}.tile{border-radius:12px}.tile .k{font-size:12px}.card>.lede{font-size:15px}.card>.caveat{font-size:14px}.axis{font-size:12px}.barlbl,.barval{font-size:12px}button{min-height:48px;background:#304e3c;color:#fff}button.ghost{color:#304e3c}.tile.alarm{background:#f7e6dc;border-color:#d9af98}.demobar{background:#f5e8c5;border-color:#d7bf7d;color:#71511b}#gate{background:white;padding:28px;border-radius:16px}.office-home{display:inline-flex;padding:12px 18px;color:#304e3c;text-decoration:none;border:1px solid #c5d0ba;border-radius:24px;margin-bottom:20px;font-weight:600}
@media(max-width:600px){.racks,.bays{grid-template-columns:repeat(2,minmax(0,1fr))}.racks.market{grid-template-columns:1fr}.rack .n{flex-wrap:wrap}.rack li{flex-wrap:wrap}.rack .st{font-size:12px}.rack li,.bay .l{font-size:13px}.card{overflow-x:auto}h1{font-size:28px}.wrap{padding:20px 16px}.card{padding:20px 16px}.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.row{flex-wrap:wrap}}
`;

/**
 * The print flow both tag screens share (sack_session and bay_tags), injected
 * as <script>${HARVEST_PRINT_CLIENT}</script> by each body that prints, so
 * there is one copy of the iframe / named-tab / agent decision instead of two
 * that drift. Plain ES5 for whatever handset the crew carries; defines window.RO.
 *
 *   RO.allocTags(api, body)          POST sack_alloc → the response, or throws its error
 *   RO.printIds(api, ids, via, opts) via 'agent' → poll print_check into opts.status;
 *                                    otherwise load sack_label (iframe on a desktop,
 *                                    a named tab on a handset, in place in the iOS app)
 *   RO.reprintTag(api, id, opts)     POST print_reprint, then printIds the way the server says
 *   RO.voidTag(api, id)              POST sack_void → the response, or throws its error
 *
 * opts: { frame (an iframe, or a function returning one; created offscreen when
 * absent), status (the element agent mode writes into), statusClass (its base
 * class, default 'hcstat'; ' ok' / ' bad' are added), T (printingOnAgent,
 * printedOnAgent, printAgentFailed {id} {e}, printAgentSlow) }.
 *
 * Authored with string concatenation only: this is a template literal, so a
 * dollar-brace or a backslash in here would be eaten before the browser sees it.
 */
export const HARVEST_PRINT_CLIENT = `
(function () {
  var RO = window.RO = window.RO || {};
  // Who prints is the server's call, per allocation (print_via), never a
  // page-level flag: a page open for an hour would print the tag twice.
  // WebKit scopes window.print() to the TOP-LEVEL document, and Android never
  // prints a 0x0 offscreen iframe, so any handset gets a top-level tab and only
  // a desktop (the barn PC) keeps the hidden iframe. See lib/print-client.js.
  var iframePrintUnreliable = ${IFRAME_PRINT_UNRELIABLE_SRC};
  var topLevelPrint = iframePrintUnreliable(
    navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  var ownFrame = null;

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }
  function ok(fallback) {
    return function (d) {
      if (!d || !d.success) throw new Error((d && d.error) || fallback);
      return d;
    };
  }
  function frameFor(opts) {
    if (typeof opts.frame === 'function') return opts.frame();
    if (opts.frame) return opts.frame;
    if (!ownFrame) {
      ownFrame = document.createElement('iframe');
      ownFrame.title = 'print';
      ownFrame.setAttribute('style', 'position:absolute;width:0;height:0;border:0;left:-9999px');
      document.body.appendChild(ownFrame);
    }
    return ownFrame;
  }

  RO.allocTags = function (api, body) {
    return postJson(api + '?action=sack_alloc', body).then(ok('Print failed'));
  };

  RO.printIds = function (api, ids, via, opts) {
    opts = opts || {};
    if (via === 'agent') { watchPrint(api, ids, opts); return; }  // the barn PC prints it
    var url = api + '?action=sack_label&ids=' + encodeURIComponent(ids.join(','));
    if (window.navigator.standalone === true) {
      // An iOS home-screen app (Koa, 2026-09-25) has no tabs: window.open fails
      // or strands the crew. Go to the label page in place; it offers
      // history.back() to return for the next bag.
      window.location.href = url + '&back=1';
      return;
    }
    if (topLevelPrint) {
      // A separate tab so window.print() runs at top level. NAMED, not _blank:
      // every tag reuses the one tab, and popup=1 has the label page close
      // itself when printing is done (Koa, 2026-09-21).
      var w = window.open(url + '&popup=1', 'rf_tag_print');
      // Blocked anyway: navigate rather than silently printing nothing.
      if (!w) window.location.href = url;
      return;
    }
    frameFor(opts).src = url;
  };

  // In agent mode the crew no longer watches a tag appear, so the screen has to
  // say whether one did. Queued is NOT printed: the serial is already spent, so
  // a tick on the strength of an enqueue would hide the failure the ack is for.
  function watchPrint(api, ids, opts) {
    var T = opts.T || {};
    var el = opts.status;
    var base = opts.statusClass || 'hcstat';
    function say(cls, text) {
      if (!el) return;
      el.hidden = false;
      el.className = base + (cls ? ' ' + cls : '');
      el.textContent = text;
    }
    var tries = 0;
    say('', T.printingOnAgent || '');
    (function poll() {
      tries += 1;
      postJson(api + '?action=print_check', { ids: ids })
        .then(function (d) {
          var st = (d && d.status) || {};
          var states = ids.map(function (id) { return (st[id] || {}).status; });
          var failed = ids.filter(function (id) { return (st[id] || {}).status === 'failed'; });
          if (failed.length) {
            say('bad', String(T.printAgentFailed || '')
              .replace('{id}', failed[0])
              .replace('{e}', (st[failed[0]] || {}).error || ''));
            return;
          }
          if (states.every(function (x) { return x === 'done'; })) {
            say('ok', T.printedOnAgent || '');
            return;
          }
          // ~30s: long enough for a rack of tags, short enough that a stopped
          // agent is noticed while the crew is still at the printer.
          if (tries < 40) return setTimeout(poll, 750);
          say('bad', T.printAgentSlow || '');
        })
        .catch(function () { if (tries < 40) setTimeout(poll, 1500); });
    })();
  }

  // A jam is the most time-critical recovery there is. ALWAYS ask the server
  // which way to print: the page may not have allocated anything, and guessing
  // 'browser' is the path WebKit breaks.
  RO.reprintTag = function (api, id, opts) {
    return postJson(api + '?action=print_reprint', { sack_id: id })
      .then(ok('Reprint failed'))
      .then(function (d) {
        RO.printIds(api, [id], d.print_via === 'agent' ? 'agent' : 'browser', opts);
        return d;
      });
  };

  RO.voidTag = function (api, id) {
    return postJson(api + '?action=sack_void', { sack_id: id }).then(ok('Void failed'));
  };
})();
`;
