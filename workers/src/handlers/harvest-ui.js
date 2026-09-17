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
.harvest-header strong{display:block;font-size:13px;letter-spacing:.12em}
.harvest-header small{color:#60715d;font-size:12px}
.harvest-header nav{margin-left:auto;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.harvest-header a{color:#304e3c;text-decoration:none;border:1px solid #c6d0bc;border-radius:24px;padding:11px 15px;font-size:13px;min-height:44px}
.harvest-screen h1{font:700 clamp(30px,4vw,42px)/1.12 Karla,system-ui,sans-serif;letter-spacing:-.035em;margin-bottom:14px}
.harvest-screen h2{font:700 21px/1.25 Karla,system-ui,sans-serif;letter-spacing:-.02em;text-transform:none;color:#304e3c;margin:26px 0 14px}
.harvest-screen :is(.sub,.hint,.lot-meta,.lotmeta,.batch,.last){color:#60715d}
.harvest-screen .sub{font-size:16px;line-height:1.6;margin-bottom:24px}
.harvest-screen .note{color:#40543f;line-height:1.6;font-size:16px}
.harvest-screen .hint{font-size:13px;line-height:1.6}
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
.harvest-screen .badge{border-radius:20px;font-size:11px;padding:6px 10px}
.harvest-screen .badge.ok{background:#e5eddb;color:#345c38}
.harvest-screen .badge.warn{background:#f8ebcb;color:#77511a}
.harvest-screen .badge.bad{background:#f4e0d8;color:#954431}
.harvest-screen .lot:not(label){padding:24px;background:#668971;color:#fff;border:0;border-radius:15px}
.harvest-screen .lot:not(label) .lot-meta{color:#fff;font-size:15px;line-height:1.6}
.harvest-screen .lot-cultivar{font-size:30px}
.harvest-screen #printBtn{background:#edc76b;color:#263f32;border-color:#edc76b;min-height:120px;font-size:30px}
.harvest-screen .status{padding:22px;background:#fff;border:1px solid #d9dfd1;border-radius:12px}
.harvest-screen .mini{min-height:44px;background:#edf1e4;color:#304e3c;border:1px solid #c2cdb8}
.harvest-screen .mini.danger{background:#fff;color:#994837;border-color:#d7b2a4}
.harvest-screen .nextnote{color:#304e3c}.harvest-screen .nextnote.pending summary{color:#825b14}
.harvest-screen .notice{background:#f8edcf;color:#77511a;border-color:#d7b574}
.harvest-screen .flash{background:#e8efdd;color:#365b36;border-color:#abc093}
.harvest-screen .finishrow{background:#fff;border-color:#d9dfd1;align-items:center;flex-wrap:wrap}
.harvest-screen .footer{padding-top:22px;border-top:1px solid #d9dfd1;font-size:14px;line-height:2}
.harvest-screen .footer a{color:#42623e;display:inline-block;min-height:44px;padding:4px 0}
.harvest-screen .cvgrid a{background:white;color:#304e3c;border:1px solid #d4ddcb;text-align:left}
.harvest-screen #intakeForm{max-width:680px}.harvest-screen #intakeForm button{width:100%;min-height:76px;background:#edc76b;color:#263f32;border-color:#d9b259}
.harvest-screen #intakeReceipt:not(:empty){padding:20px;background:#e9efdf;border:1px solid #c4d2b5;border-radius:12px;margin:18px 0}
.intake-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:18px 0 26px}
.harvest-screen .intake-choice{display:flex;align-items:center;gap:16px;min-height:110px;padding:20px;text-decoration:none;border:2px solid transparent;border-radius:14px}
.harvest-screen .intake-choice.crew-a{background:#304e3c;color:#fff;border-color:#304e3c}
.harvest-screen .intake-choice.crew-b{background:#f2cf78;color:#3d321b;border-color:#c59939}
.intake-letter{display:grid;place-items:center;width:56px;height:56px;flex:none;border-radius:10px;font-size:36px;font-weight:800;border:1px solid currentColor}
.intake-choice strong{display:block;font-size:23px;line-height:1.2}
.intake-choice small{display:block;font-size:14px;margin-top:6px}
.intake-arrow{margin-left:auto;font-size:26px}
.harvest-screen .intake-choice:hover{box-shadow:0 0 0 3px #9ba98c}
@media(max-width:600px){.intake-choices{grid-template-columns:1fr;gap:16px}.harvest-screen .intake-choice{min-height:104px}}
.harvest-screen #intakeActive{margin-bottom:14px;font-size:17px;font-weight:600}
.harvest-screen #followCrew{font-size:14px;min-height:44px}
.harvest-screen .reconcile-table{overflow:auto}.harvest-screen table{border-collapse:collapse;width:100%;font-size:15px;white-space:nowrap}
.harvest-screen td,.harvest-screen th{text-align:left;padding:15px 12px;border-bottom:1px solid #d7dfcd}
.harvest-screen th{font-size:12px;color:#60715d}
.harvest-screen .crew-stepper{display:flex;align-items:center;gap:10px;margin:8px 0 20px}
.harvest-screen .crew-stepper input{margin:0;max-width:100px;text-align:center}
.harvest-screen .crew-stepper button{min-width:50px;min-height:50px;border:1px solid #c5d1b9;border-radius:8px;background:#e9eedf;color:#304e3c;font-size:26px}
.harvest-screen :is(button,a,input,select,textarea,summary):focus-visible{outline:3px solid #9c7423;outline-offset:3px}
@media(min-width:900px){.harvest-screen:has(#intakeForm),.harvest-screen:has(.crew-stepper),.harvest-screen:has(.grid),.harvest-screen:has(#printBtn){max-width:800px}}
@media(max-width:600px){.harvest-screen{padding:0 16px 30px}.harvest-header{gap:8px}.harvest-header img{width:42px;height:42px}.harvest-header strong{font-size:11px}.harvest-header small{display:none}.harvest-header nav{gap:4px}.harvest-header a{padding:11px 10px;font-size:12px}.harvest-screen form:not(.finishrow):not(.finishlot){padding:18px}.harvest-screen .lothead{font-size:17px}.harvest-screen .lastActions{flex-wrap:wrap}}
@media(max-width:700px){body.testmode:has(.sd)>.testband{margin-left:-18px;margin-right:-18px}}
@media print{.harvest-header{display:none}}
`;

export const OFFICE_UI_STYLE = `
:root{--bg:#f6f5ef;--panel:#fff;--raised:#edf1e5;--line:#d9dfd1;--line2:#becdb2;--ink:#263f32;--ink2:#455b43;--muted:#5e7159;--leaf:#4d7a48;--straw:#96721e;--clay:#a26932;--sky:#47708a;--plum:#885c92;--bad:#9f4837;--ok:#3e773f}
.split>*{min-width:0}svg{max-width:100%}.rack.vacant,.bay.empty{opacity:1;background:var(--bg)}.rack.vacant .bn{color:var(--muted)}.k-tag{background:#f4e7c8;color:#76561d}.testpill{background:#f4e7c8;color:#76561d;border-color:#c6a964}details>summary{cursor:pointer;font-weight:700;padding:18px 0}details>summary:focus-visible{outline:3px solid #997223}
body{font-family:Karla,system-ui,sans-serif}.wrap{padding-top:24px}h1{font-size:36px;letter-spacing:-.04em}.card{border-radius:15px}.tile{border-radius:12px}.tile .k{font-size:12px}.card>.lede{font-size:15px}.card>.caveat{font-size:14px}.axis{font-size:12px}.barlbl,.barval{font-size:12px}button{min-height:48px;background:#304e3c;color:#fff}button.ghost{color:#304e3c}.tile.alarm{background:#f7e6dc;border-color:#d9af98}.demobar{background:#f5e8c5;border-color:#d7bf7d;color:#71511b}#gate{background:white;padding:28px;border-radius:16px}.office-home{display:inline-flex;padding:12px 18px;color:#304e3c;text-decoration:none;border:1px solid #c5d0ba;border-radius:24px;margin-bottom:20px;font-weight:600}
@media(max-width:600px){.racks,.bays{grid-template-columns:repeat(2,minmax(0,1fr))}.racks.market{grid-template-columns:1fr}.rack .n{flex-wrap:wrap}.rack li{flex-wrap:wrap}.rack .st{font-size:12px}.rack li,.bay .l{font-size:13px}.card{overflow-x:auto}h1{font-size:28px}.wrap{padding:20px 16px}.card{padding:20px 16px}.strip{grid-template-columns:repeat(2,minmax(0,1fr))}.row{flex-wrap:wrap}}
`;
