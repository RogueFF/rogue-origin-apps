"""Build the three card mocks (midday / end of day / weekly) from real API JSON and render PNGs.
Layout rules: flex only (Satori-compatible), 1080x1350, Hub dark tokens."""
import json, pathlib, re
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).parent
DATA = HERE.parent
OUT = HERE

def J(name):
    return json.load(open(DATA / name, encoding="utf-8"))

CSS = """
html,body{margin:0;padding:0}
body{width:1080px;height:1350px;background:#0f1210}
.card{width:1080px;height:1350px;box-sizing:border-box;padding:52px 56px 40px;display:flex;flex-direction:column;background:#1a1f1c;color:rgba(255,255,255,.9);font-family:'Outfit',sans-serif}
.mono{font-family:'JetBrains Mono',monospace}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:20px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.44)}
.head{display:flex;justify-content:space-between;align-items:flex-end}
.title{font-family:'DM Serif Display',serif;font-style:italic;font-size:84px;line-height:1;margin-top:6px;color:rgba(255,255,255,.92)}
.sub{font-size:29px;color:rgba(255,255,255,.62);margin-top:10px}
.pill{display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:22px;color:rgba(255,255,255,.7);background:#161b18;border:2px solid rgba(255,255,255,.14);border-radius:999px;padding:12px 24px}
.tiles{display:flex;gap:18px;margin-top:28px}
.tile{flex:1;display:flex;flex-direction:column;background:#161b18;border:2px solid rgba(255,255,255,.07);border-radius:24px;padding:22px 28px 20px}
.tile .label{font-size:24px;color:rgba(255,255,255,.62)}
.tile .value{display:flex;align-items:baseline;margin-top:8px}
.tile .num{font-size:76px;font-weight:600;line-height:1;letter-spacing:-.02em}
.tile .unit{font-size:28px;color:rgba(255,255,255,.5);margin-left:10px}
.chips{display:flex;gap:8px;margin-top:16px}
.chip{display:flex;align-items:center;font-family:'JetBrains Mono',monospace;font-size:19px;padding:7px 12px;border-radius:999px;white-space:nowrap}
.chip.good{color:#7fbf95;background:rgba(127,191,149,.14)}
.chip.bad{color:#e07b6b;background:rgba(224,123,107,.14)}
.chip.warn{color:#e4aa4f;background:rgba(228,170,79,.16)}
.chip.neutral{color:rgba(255,255,255,.62);background:rgba(255,255,255,.07)}
.chart{display:flex;flex-direction:column;margin-top:18px;background:#161b18;border:2px solid rgba(255,255,255,.07);border-radius:24px;padding:22px 30px 18px}
.chart-head{display:flex;justify-content:space-between;align-items:baseline}
.chart-title{font-size:28px;font-weight:500}
.chart-sub{font-family:'JetBrains Mono',monospace;font-size:20px;color:rgba(255,255,255,.44)}
.plot{display:flex;align-items:flex-end;height:224px;margin-top:34px;border-bottom:2px solid rgba(255,255,255,.14)}
.col{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:224px}
.cap{position:absolute;left:0;right:0;display:flex;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:24px;color:rgba(255,255,255,.9)}
.bar{background:#4fa06b;border-radius:10px 10px 0 0}
.bar.off{height:8px;background:rgba(255,255,255,.08)}
.bar.now{background:rgba(79,160,107,.25);border:2px dashed rgba(127,191,149,.6);border-bottom:0}
.tick{position:absolute;left:10px;right:10px;border-top:3px dashed #e4aa4f}
.axis{display:flex;margin-top:12px}
.axis .d{flex:1;display:flex;flex-direction:column;align-items:center}
.axis .day{font-size:24px;color:rgba(255,255,255,.62)}
.axis .rate{font-family:'JetBrains Mono',monospace;font-size:20px;color:rgba(255,255,255,.44);margin-top:2px}
.legend{display:flex;align-items:center;gap:10px;font-family:'JetBrains Mono',monospace;font-size:18px;color:rgba(255,255,255,.44)}
.legend .sw{width:28px;border-top:3px dashed #e4aa4f}
.row2{display:flex;gap:18px;margin-top:18px}
.mini{flex:1;display:flex;flex-direction:column;background:#161b18;border:2px solid rgba(255,255,255,.07);border-radius:20px;padding:16px 24px 14px}
.mini .label{font-size:22px;color:rgba(255,255,255,.62)}
.mini .v{display:flex;align-items:baseline;font-family:'JetBrains Mono',monospace;font-size:36px;margin-top:4px;color:rgba(255,255,255,.9)}
.mini .v .u{font-size:20px;color:rgba(255,255,255,.5);margin-left:8px}
.mini .s{font-family:'JetBrains Mono',monospace;font-size:20px;color:rgba(255,255,255,.44);margin-top:4px}
.watch{display:flex;flex-direction:column;gap:8px;margin-top:16px}
.flag{display:flex;align-items:center;border-radius:16px;padding:12px 20px;font-size:24px}
.flag .dot{width:14px;height:14px;border-radius:7px;margin-right:16px}
.flag .tag{font-family:'JetBrains Mono',monospace;font-size:19px;text-transform:uppercase;letter-spacing:.08em;margin-right:18px;width:74px}
.flag.bad{background:rgba(224,123,107,.14)} .flag.bad .dot{background:#e07b6b} .flag.bad .tag{color:#e07b6b}
.flag.warn{background:rgba(228,170,79,.16)} .flag.warn .dot{background:#e4aa4f} .flag.warn .tag{color:#e4aa4f}
.flag.good{background:rgba(127,191,149,.14)} .flag.good .dot{background:#7fbf95} .flag.good .tag{color:#7fbf95}
.foot{display:flex;justify-content:space-between;margin-top:auto;font-family:'JetBrains Mono',monospace;font-size:17px;color:rgba(255,255,255,.35)}
"""

HEAD = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=JetBrains+Mono:wght@400;500;600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style></head><body><div class="card">"""
TAIL = "</div></body></html>"

def tile(label, num, unit="", chips=()):
    ch = "".join(f'<div class="chip {k}">{t}</div>' for k, t in chips)
    u = f'<div class="unit">{unit}</div>' if unit else ""
    return f'<div class="tile"><div class="label">{label}</div><div class="value"><div class="num">{num}</div>{u}</div><div class="chips">{ch}</div></div>'

def mini(label, v, u="", s=""):
    return f'<div class="mini"><div class="label">{label}</div><div class="v">{v}{f"<div class=u>{u}</div>" if u else ""}</div><div class="s">{s}</div></div>'

def flag(kind, tag, text):
    return f'<div class="flag {kind}"><div class="dot"></div><div class="tag">{tag}</div><div>{text}</div></div>'

def chart(title, sub, cols, bar_w, px_per_lb, legend="target, crew-adjusted"):
    """cols: list of dict(label, rate, lbs, target, kind) kind in bar|off|now"""
    plot = ""
    axis = ""
    for c in cols:
        if c["kind"] == "off":
            body = '<div class="cap" style="color:rgba(255,255,255,.44);bottom:18px">off</div><div class="bar off" style="width:%dpx"></div>' % bar_w
        elif c["kind"] == "now":
            nh = max(10, int(c["target"] * px_per_lb))
            body = '<div class="cap" style="color:rgba(255,255,255,.44);bottom:%dpx">now</div><div class="bar now" style="width:%dpx;height:%dpx"></div>' % (nh + 10, bar_w, nh)
        else:
            h = max(6, int(round(c["lbs"] * px_per_lb)))
            top = max(h, int(round((c.get("target") or 0) * px_per_lb))) + 10
            body = f'<div class="cap" style="bottom:{top}px">{c["lbs"]:.0f}</div><div class="bar" style="width:{bar_w}px;height:{h}px"></div>'
        tick = ""
        if c.get("target"):
            tick = f'<div class="tick" style="bottom:{int(round(c["target"] * px_per_lb))}px"></div>'
        plot += f'<div class="col">{tick}{body}</div>'
        axis += f'<div class="d"><div class="day">{c["label"]}</div><div class="rate">{c["rate"]}</div></div>'
    return (f'<div class="chart"><div class="chart-head"><div class="chart-title">{title}</div>'
            f'<div class="legend"><div class="sw"></div>{legend} · <span class="chart-sub">{sub}</span></div></div>'
            f'<div class="plot">{plot}</div><div class="axis">{axis}</div></div>')

def slot_label(ts):
    m = re.match(r"(\d+):(\d+)\s*([AP]M)", ts)
    h, mi = int(m.group(1)), m.group(2)
    return f"{h}½" if mi == "30" else f"{h}"

def hourly_cols(rows, rate_target, now_slot=None):
    cols = []
    for r in rows:
        tgt = (r.get("trimmers") or 0) * rate_target * (r.get("multiplier") or 1)
        cols.append(dict(label=slot_label(r["timeSlot"]), rate=f'{r["rate"]:.2f}', lbs=r["lbs"], target=tgt, kind="bar"))
    if now_slot:
        cols.append(dict(label=slot_label(now_slot["timeSlot"]), rate="—", lbs=0, target=now_slot["target"], kind="now"))
    return cols

def sort_slots(rows):
    def key(r):
        m = re.match(r"(\d+):(\d+)\s*([AP]M)", r["timeSlot"]); h = int(m.group(1)) % 12 + (12 if m.group(3) == "PM" else 0)
        return h * 60 + int(m.group(2))
    return sorted(rows, key=key)

# ------------------------------------------------------------------ MIDDAY
def midday():
    sb = J("sb_today.json")["scoreboard"]
    rows = sort_slots(sb["hourlyRates"])
    tops = sum(r["lbs"] for r in rows); smalls = sum(r.get("smalls") or 0 for r in rows)
    eff_h = sum((r.get("effectiveTrimmers") or r["trimmers"]) * (r.get("multiplier") or 1) for r in rows)
    rate = tops / eff_h
    pct = sb["todayPercentage"]; proj = sb["projectedTotal"]; tr = sb["targetRate"]
    last = rows[-1]; bt = last["buckers"] / last["trimmers"]
    fri = 120.1
    now = dict(timeSlot="12:30 PM – 1:00 PM", target=sb["currentHourTarget"])
    cols = hourly_cols(rows, tr, now)
    maxv = max(max(c["lbs"], c["target"]) for c in cols); ppl = 224 * 0.82 / maxv
    html = HEAD.format(title="Midday card", css=CSS)
    html += f'''<div class="head"><div style="display:flex;flex-direction:column">
      <div class="eyebrow">Rogue Origin · Midday check</div><div class="title">Monday</div>
      <div class="sub">Oct 19 · Sour Lifter '26 · through 12:00</div></div>
      <div class="pill">Line crew {last["trimmers"]} T · {last["buckers"]} B · 1 TZ</div></div>
    <div class="tiles">
      {tile("Tops so far", f"{tops:.0f}", "lb", [("good", f"▲ {pct:.0f}% of target")])}
      {tile("Rate", f"{rate:.2f}", "lb/hr", [("good", f"▲ target {tr:.2f}")])}
      {tile("Projected end of day", f"{proj:.0f}", "lb", [("neutral", f"Fri closed at {fri:.0f}")])}
    </div>
    {chart("Tops by hour", "lb · rate under the hour", cols, 48, ppl)}
    <div class="row2">
      {mini("Smalls so far", f"{smalls:.0f}", "lb")}
      {mini("Buckers per trimmer", f"{bt:.2f}", "", "band 0.70–0.75, fed")}
      {mini("Hours logged", f"{sb['effectiveHours']:.1f}", "of 8.5", "sacks logged: 0")}
    </div>
    <div class="watch">
      {flag("good", "Good", "Every hour above target so far, best 2.14 at 9–10")}
      {flag("warn", "Watch", "8:00 note: QC lead is trimming, so the 8-trimmer rate is flattered")}
      {flag("warn", "Watch", "No supersacks logged on the tracker yet today")}
    </div>
    <div class="foot"><div>cards/midday · scoreboard target · $/lb at close</div><div>generated Mon Oct 19 · 12:35 PT</div></div>'''
    return html + TAIL

# ------------------------------------------------------------------ END OF DAY
def eod():
    sb = J("sb_20261016.json")["scoreboard"]
    rows = sort_slots(sb["hourlyRates"])
    cols = hourly_cols(rows, sb["targetRate"])
    maxv = max(max(c["lbs"], c["target"]) for c in cols); ppl = 224 * 0.82 / maxv
    html = HEAD.format(title="End of day card", css=CSS)
    html += f'''<div class="head"><div style="display:flex;flex-direction:column">
      <div class="eyebrow">Rogue Origin · End of day</div><div class="title">Friday</div>
      <div class="sub">Oct 16 · Sour Lifter '26 · 8.5 h logged</div></div>
      <div class="pill">Line crew peak 18 · 8 T · 9 B</div></div>
    <div class="tiles">
      {tile("Tops", "120", "lb", [("good", "▲ 112% of target")])}
      {tile("Rate", "1.62", "lb/hr", [("good", "▲ +0.34 vs Thu")])}
      {tile("$ per lb tops", "$27.51", "", [("good", "▼ −$3.43 vs Thu")])}
    </div>
    {chart("Tops by hour", "lb · rate under the hour", cols, 48, ppl)}
    <div class="row2">
      {mini("Smalls", "90", "lb", "$14.27/lb")}
      {mini("Supersacks", "20", "opened", "700 lb raw · 6.0 tops/sack")}
      {mini("Labor", "$4,589", "", "all-in $38.21/lb")}
    </div>
    <div class="watch">
      {flag("bad", "Act", "2 PM: bags stored below are very wet, spoilage risk, need a plan")}
      {flag("good", "Good", "Best rate of the week with the smallest crew, 9 buckers for 8 trimmers")}
      {flag("warn", "Watch", "Crew fell 8 → 5 trimmers after 2 PM, line wound down early")}
    </div>
    <div class="foot"><div>cards/eod · dashboard allocation · $/lb tops</div><div>generated Fri Oct 16 · 17:05 PT</div></div>'''
    return html + TAIL

# ------------------------------------------------------------------ WEEKLY
def weekly():
    days = [("Mon", None, None, None), ("Tue", "20261013", 110.8, 1.08), ("Wed", "20261014", 139.8, 1.38),
            ("Thu", "20261015", 126.5, 1.28), ("Fri", "20261016", 120.1, 1.62)]
    cols = []; tsum = 0
    for lab, f, lbs, rate in days:
        if f is None:
            cols.append(dict(label=lab, rate="—", lbs=0, target=0, kind="off")); continue
        tgt = J(f"sb_{f}.json")["scoreboard"]["todayTarget"]; tsum += tgt
        cols.append(dict(label=lab, rate=f"{rate:.2f}", lbs=lbs, target=tgt, kind="bar"))
    maxv = max(max(c["lbs"], c["target"]) for c in cols); ppl = 224 * 0.82 / maxv
    wk_pct = 497.2 / tsum * 100
    html = HEAD.format(title="Weekly card", css=CSS)
    html += f'''<div class="head"><div style="display:flex;flex-direction:column">
      <div class="eyebrow">Rogue Origin · Weekly production</div><div class="title">Week 42</div>
      <div class="sub">Oct 12–16, 2026 · Sour Lifter '26 · 4 days</div></div>
      <div class="pill">Line crew 18–27 · avg 22</div></div>
    <div class="tiles">
      {tile("Tops", "497", "lb", [("good", "▲ +261% vs W41"), ("warn", f"{wk_pct:.0f}% target")])}
      {tile("Rate", "1.34", "lb/hr", [("good", "▲ +0.14 vs W41")])}
      {tile("$ per lb tops", "$30.28", "", [("good", "▼ −$4.84 vs W41")])}
    </div>
    {chart("Tops by day", "lb · rate under the day", cols, 72, ppl)}
    <div class="row2">
      {mini("Smalls", "429", "lb", "$12.76/lb")}
      {mini("Supersacks", "88", "opened", "3,080 lb raw · 5.6 tops/sack")}
      {mini("Labor", "$20,530", "", "all-in $41.29/lb")}
    </div>
    <div class="watch">
      {flag("bad", "Act", "Fri: wet bags stored below, spoilage risk")}
      {flag("warn", "Watch", "Mold, worms and moisture flagged Tue–Thu")}
      {flag("good", "Good", "Fresh crop at 1.34 vs ~0.9 last season, rate rose all week")}
    </div>
    <div class="foot"><div>cards/weekly · dashboard allocation · $/lb tops</div><div>generated Mon Oct 19 · 06:05 PT</div></div>'''
    return html + TAIL

if __name__ == "__main__":
    pages = {"card-midday": midday(), "card-eod": eod(), "card-weekly": weekly()}
    for name, html in pages.items():
        (OUT / f"{name}.html").write_text(html, encoding="utf-8")
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1080, "height": 1350})
        for name in pages:
            pg.goto((OUT / f"{name}.html").as_uri()); pg.wait_for_load_state("networkidle")
            pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)
            pg.screenshot(path=str(OUT / f"{name}.png"), clip={"x": 0, "y": 0, "width": 1080, "height": 1350})
            print("rendered", name)
        b.close()
