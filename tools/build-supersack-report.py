"""Build a one-shot PDF report of supersack yield analytics."""
import urllib.request
import json
import datetime
import sys

from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_LEFT, TA_CENTER

API = "https://rogue-origin-api.roguefamilyfarms.workers.dev/api/supersack-d1"
SACK_WEIGHT = 37
TODAY = datetime.date.today().isoformat()

RO_GREEN = colors.HexColor("#668971")
RO_GOLD = colors.HexColor("#e4aa4f")
RO_DARK = colors.HexColor("#141816")
RO_TEXT = colors.HexColor("#2a2a2a")
RO_DIM = colors.HexColor("#6a6a6a")
RO_CARD = colors.HexColor("#f7f5ef")
RO_LINE = colors.HexColor("#d8d5cc")

def fetch(url):
    req = urllib.request.Request(url, headers={
        "Origin": "http://localhost:3000",
        "User-Agent": "supersack-report-builder/1.0",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = json.loads(r.read())
    return raw.get("data", raw)

def short_strain(name):
    name = name.replace("2025 - ", "").replace(" / Sungrown", "")
    return name

def main(output_path):
    summary = fetch(f"{API}?action=summary&start=2026-01-01&end=2026-12-31&complete=true")
    history = fetch(f"{API}?action=history&start=2026-01-01&end=2026-12-31&complete=true")

    strains = summary.get("strains", [])
    periods = summary.get("periods", [])
    entries = history.get("entries", [])

    total_sacks = sum(p["total_sacks"] for p in periods)
    total_raw = sum(p["total_raw"] for p in periods)
    total_tops = sum(p["total_tops"] for p in periods)
    total_smalls = sum(p["total_smalls"] for p in periods)
    total_bio = sum(p["total_biomass"] for p in periods)
    total_trim = sum(p["total_trim"] for p in periods)
    total_waste = sum(p["total_waste"] for p in periods)
    days = len(periods)
    first_date = min(e["date"] for e in entries) if entries else "n/a"
    last_date = max(e["date"] for e in entries) if entries else "n/a"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(letter),
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.5 * inch,
        title="Supersack Yield Analysis",
        author="Rogue Origin",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"],
        fontName="Helvetica-Bold", fontSize=22, textColor=RO_DARK,
        spaceAfter=4, alignment=TA_LEFT,
    )
    subtitle_style = ParagraphStyle(
        "Subtitle", parent=styles["Normal"],
        fontName="Helvetica", fontSize=11, textColor=RO_DIM,
        spaceAfter=14,
    )
    h2_style = ParagraphStyle(
        "H2", parent=styles["Heading2"],
        fontName="Helvetica-Bold", fontSize=14, textColor=RO_GREEN,
        spaceBefore=10, spaceAfter=6,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontName="Helvetica", fontSize=10, textColor=RO_TEXT, leading=14,
    )
    note_style = ParagraphStyle(
        "Note", parent=styles["Normal"],
        fontName="Helvetica-Oblique", fontSize=9, textColor=RO_DIM, leading=12,
    )

    story = []

    story.append(Paragraph("Supersack Yield Analysis", title_style))
    story.append(Paragraph(
        f"Predicted finished-goods ratios &nbsp;·&nbsp; Generated {TODAY} &nbsp;·&nbsp; "
        f"Window {first_date} → {last_date} &nbsp;·&nbsp; {days} production days",
        subtitle_style,
    ))

    # --- KPI strip --------------------------------------------------------
    def kpi_cell(label, value, accent=RO_GOLD):
        return [
            Paragraph(f'<font color="{RO_DIM}" size="8">{label.upper()}</font>', body_style),
            Paragraph(f'<font color="{accent}" size="18"><b>{value}</b></font>', body_style),
        ]

    kpi_data = [[
        kpi_cell("Sacks opened", f"{total_sacks:,}"),
        kpi_cell("Raw input", f"{total_raw:,.0f} lbs"),
        kpi_cell("Tops + Smalls (finished)", f"{100*(total_tops+total_smalls)/total_raw:.1f}%", RO_GREEN),
        kpi_cell("Biomass", f"{100*total_bio/total_raw:.1f}%"),
        kpi_cell("Trim", f"{100*total_trim/total_raw:.1f}%"),
        kpi_cell("Waste", f"{100*total_waste/total_raw:.1f}%", colors.HexColor("#c45c4a")),
    ]]
    kpi_table = Table(kpi_data, colWidths=[1.6 * inch] * 6)
    kpi_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), RO_CARD),
        ("BOX", (0, 0), (-1, -1), 0.5, RO_LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, RO_LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(kpi_table)
    story.append(Spacer(1, 12))

    # --- Per-strain yield ratios -----------------------------------------
    story.append(Paragraph("Per-Strain Yield Ratios (% of raw input)", h2_style))

    yield_header = ["Strain", "Sacks", "Days", "Tops %", "Smalls %", "Bio %", "Trim %", "Waste %", "Σ"]
    yield_rows = [yield_header]
    for s in strains:
        raw = s.get("total_raw", 0)
        if not raw:
            continue
        tp = 100 * s["total_tops"] / raw
        sp = 100 * s["total_smalls"] / raw
        bp = 100 * s["total_biomass"] / raw
        tr = 100 * s["total_trim"] / raw
        wp = 100 * s["total_waste"] / raw
        total = tp + sp + bp + tr + wp
        yield_rows.append([
            short_strain(s["strain"]),
            f"{s['total_sacks']}",
            f"{s.get('days_worked', 0)}",
            f"{tp:.1f}",
            f"{sp:.1f}",
            f"{bp:.1f}",
            f"{tr:.1f}",
            f"{wp:.1f}",
            f"{total:.1f}",
        ])

    yield_table = Table(yield_rows, colWidths=[
        2.3 * inch, 0.6 * inch, 0.6 * inch,
        0.85 * inch, 0.95 * inch, 0.85 * inch, 0.85 * inch, 0.95 * inch, 0.7 * inch,
    ], repeatRows=1)
    yield_style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RO_GREEN),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, RO_DARK),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, RO_LINE),
    ])
    for i in range(1, len(yield_rows)):
        if i % 2 == 0:
            yield_style.add("BACKGROUND", (0, i), (-1, i), RO_CARD)
    yield_table.setStyle(yield_style)
    story.append(yield_table)

    story.append(Spacer(1, 14))

    # --- Per-sack expected output (lbs) ----------------------------------
    story.append(Paragraph("Expected Output per Sack (lbs of each output type)", h2_style))
    story.append(Paragraph(
        f"Assumes <b>{SACK_WEIGHT} lbs raw per sack</b>. Use these to forecast finished-goods volume from a known sack count.",
        body_style,
    ))
    story.append(Spacer(1, 6))

    perlb_header = ["Strain", "Sacks (n)", "Tops (lbs)", "Smalls (lbs)", "Tops+Smalls", "Biomass", "Trim", "Waste"]
    perlb_rows = [perlb_header]
    for s in strains:
        raw = s.get("total_raw", 0)
        if not raw:
            continue
        n = s["total_sacks"]
        tops_per = s["total_tops"] / n
        smalls_per = s["total_smalls"] / n
        bio_per = s["total_biomass"] / n
        trim_per = s["total_trim"] / n
        waste_per = s["total_waste"] / n
        perlb_rows.append([
            short_strain(s["strain"]),
            f"{n}",
            f"{tops_per:.2f}",
            f"{smalls_per:.2f}",
            f"{tops_per + smalls_per:.2f}",
            f"{bio_per:.2f}",
            f"{trim_per:.2f}",
            f"{waste_per:.2f}",
        ])
    perlb_table = Table(perlb_rows, colWidths=[
        2.3 * inch, 0.8 * inch, 0.95 * inch, 0.95 * inch, 1.1 * inch,
        0.85 * inch, 0.85 * inch, 0.85 * inch,
    ], repeatRows=1)
    perlb_style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), RO_GOLD),
        ("TEXTCOLOR", (0, 0), (-1, 0), RO_DARK),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 10),
        ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 10),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, RO_DARK),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, RO_LINE),
    ])
    for i in range(1, len(perlb_rows)):
        if i % 2 == 0:
            perlb_style.add("BACKGROUND", (0, i), (-1, i), RO_CARD)
    perlb_table.setStyle(perlb_style)
    story.append(perlb_table)

    story.append(Spacer(1, 14))

    # --- Methodology -----------------------------------------------------
    story.append(Paragraph("Methodology &amp; Caveats", h2_style))

    notes = [
        f"<b>Sample.</b> {total_sacks:,} sacks across {days} production days "
        f"({first_date} → {last_date}). 11 strains tracked.",
        "<b>Exclusions.</b> The analytics drops rows where biomass = 0 OR trim = 0 "
        "(missing weight entries) and rows where tops+smalls+biomass+trim &gt; 1.5× raw input "
        "(impossible material balance — usually a multi-strain day where the day's "
        "biomass/trim total got attributed disproportionately to a low-sack strain).",
        "<b>Raw input assumption.</b> Each sack is counted as 37 lbs raw. Real sacks vary, "
        "so the Σ column rarely lands at exactly 100% — anything in the 95–115% range is "
        "considered clean. Larger deviations may signal sack-weight drift worth investigating.",
        "<b>Multi-strain attribution.</b> Biomass and trim are entered as day-totals and "
        "split across that day's strains by sack count ratio. Per-strain biomass/trim "
        "ratios are approximations; tops and smalls are entered per-strain and are exact.",
        "<b>Thin samples.</b> Strains with under 10 sacks of data (Hawaiian Haze, "
        "Legendary Platinum OG, Passion Fruit OG) carry meaningful sampling noise. "
        "Treat their ratios as directional, not predictive.",
    ]
    for n in notes:
        story.append(Paragraph(n, body_style))
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"Source: <b>supersack_entries</b> table in Cloudflare D1, filtered via "
        f"<font face='Courier' size='9'>complete=true</font> on the analytics endpoint. "
        f"Live data — re-run script to refresh.",
        note_style,
    ))

    doc.build(story)
    print(f"OK: wrote {output_path}")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "supersack-yield-analysis.pdf"
    main(out)
