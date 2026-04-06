#!/usr/bin/env python3
"""
Weekly production chart generator for SQDCP board.
Pulls live data from Cloudflare Workers API, generates PDF, optionally emails it.

Usage:
  python generate_production_charts.py                    # Generate PDF only
  python generate_production_charts.py --email            # Generate + email
  python generate_production_charts.py --email --resend-key=re_xxx  # With explicit key
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Patch
import numpy as np
from datetime import datetime, timedelta
import json
import urllib.request
import os
import sys
import argparse

# ── CONFIG ────────────────────────────────────────────────────────────────────

API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api/production'
EMAIL_TO = 'Roguefamilyfarms@gmail.com'
EMAIL_FROM = 'Rogue Origin Reports <onboarding@resend.dev>'

# ── FETCH LIVE DATA ──────────────────────────────────────────────────────────

def get_date_range():
    """Return start of prior month and end of current month."""
    today = datetime.now()
    # First day of current month
    first_of_current = today.replace(day=1)
    # First day of prior month
    first_of_prior = (first_of_current - timedelta(days=1)).replace(day=1)
    # Last day of current month (first of next month - 1 day)
    if today.month == 12:
        last_of_current = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last_of_current = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
    # Don't go past today
    end_date = min(today, last_of_current)
    return first_of_prior.strftime('%Y-%m-%d'), end_date.strftime('%Y-%m-%d')


def fetch_production_data():
    """Pull daily production data from the Cloudflare Workers API."""
    start, end = get_date_range()
    url = f'{API_BASE}?action=dashboard&start={start}&end={end}'
    print(f'Fetching data: {start} to {end}')

    req = urllib.request.Request(url, headers={
        'User-Agent': 'RogueOrigin-ChartBot/1.0',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = json.loads(resp.read().decode())

    data = raw.get('data', raw)
    daily = data.get('daily', [])

    if not daily:
        print('ERROR: No daily data returned from API')
        sys.exit(1)

    print(f'Got {len(daily)} days of data')

    # Normalize cultivar names
    for d in daily:
        cult = d.get('cultivar', '')
        c = (cult or '').lower()
        if 'lifter' in c:
            d['cultivar_short'] = 'Lifter'
        elif 'godfather' in c:
            d['cultivar_short'] = 'Godfather OG'
        elif 'platinum' in c:
            d['cultivar_short'] = 'Platinum OG'
        elif 'lemon' in c:
            d['cultivar_short'] = 'Lemon CD'
        elif not cult:
            d['cultivar_short'] = 'Unknown'
        else:
            d['cultivar_short'] = cult

        # Ensure totalCrew exists (fallback to operatorHours / 7.5 as rough headcount)
        if 'totalCrew' not in d or not d['totalCrew']:
            op_hrs = d.get('operatorHours', 0)
            d['totalCrew'] = max(1, round(op_hrs / 7.5)) if op_hrs > 0 else 1

    return daily


def split_by_month(daily):
    """Group data by month, return list of (month_label, data) tuples."""
    months = {}
    for d in daily:
        dt = datetime.strptime(d['date'], '%Y-%m-%d')
        key = dt.strftime('%Y-%m')
        if key not in months:
            months[key] = []
        months[key].append(d)

    result = []
    for key in sorted(months.keys()):
        dt = datetime.strptime(key + '-01', '%Y-%m-%d')
        label = dt.strftime('%B %Y')
        result.append((label, months[key]))
    return result


# ── HELPERS ───────────────────────────────────────────────────────────────────

CULTIVAR_COLORS = {
    'Lifter': '#C62828',
    'Godfather OG': '#1565C0',
    'Platinum OG': '#1565C0',
    'Lemon CD': '#2E7D32',
    'Unknown': '#757575',
}

def get_color(cultivar):
    return CULTIVAR_COLORS.get(cultivar, '#757575')

def short_date(d):
    dt = datetime.strptime(d, '%Y-%m-%d')
    return f"{dt.day}-{dt.strftime('%b')}"

def short_cultivar(cultivar):
    abbrevs = {'Lifter': 'LFT', 'Godfather OG': 'GOG', 'Platinum OG': 'POG', 'Lemon CD': 'LCD', 'Unknown': '??'}
    return abbrevs.get(cultivar, cultivar[:3].upper())

def calc_dynamic_targets(days):
    targets = []
    for idx, day in enumerate(days):
        cultivar = day['cultivar_short']
        prior = [days[j]['avgRate'] for j in range(idx) if days[j]['cultivar_short'] == cultivar and days[j]['totalLbs'] > 0]
        window = prior[-7:]
        if len(window) == 0:
            targets.append(None)
        else:
            targets.append(round(sum(window) / len(window), 3))
    return targets

def calc_cost_variance(days):
    results = []
    for idx, day in enumerate(days):
        start = max(0, idx - 7)
        window = days[start:idx]
        if len(window) == 0:
            results.append(None)
        else:
            baseline = sum(d['costPerLb'] for d in window) / len(window)
            variance = ((day['costPerLb'] - baseline) / baseline) * 100
            results.append(round(variance, 1))
    return results

def linear_trend(values):
    n = len(values)
    x = np.arange(n)
    if n < 2:
        return values
    coeffs = np.polyfit(x, values, 1)
    return np.polyval(coeffs, x)


# ── CHART STYLING ─────────────────────────────────────────────────────────────

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size': 10,
    'axes.facecolor': 'white',
    'figure.facecolor': 'white',
    'axes.grid': False,
    'axes.linewidth': 0.8,
    'figure.dpi': 150,
})

TITLE_SIZE = 13
SUBTITLE_SIZE = 11
AXIS_LABEL_SIZE = 10
TICK_SIZE = 8
DATA_LABEL_SIZE = 7.5
DATA_LABEL_SMALL = 6.5
LEGEND_SIZE = 8
BADGE_SIZE = 10
SUPTITLE_SIZE = 15

def make_x_labels(data):
    labels = []
    for d in data:
        date_str = short_date(d['date'])
        cult_str = short_cultivar(d['cultivar_short'])
        labels.append(f"{date_str}\n{cult_str}")
    return labels

def style_axes(ax):
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_linewidth(0.8)
    ax.spines['bottom'].set_linewidth(0.8)
    ax.tick_params(axis='both', which='major', labelsize=TICK_SIZE, width=0.8, length=4)
    ax.yaxis.grid(True, linestyle='-', alpha=0.15, color='#666', linewidth=0.5)
    ax.set_axisbelow(True)


# ── CHART DRAWING FUNCTIONS ──────────────────────────────────────────────────

def draw_production_rate(ax, data, month_label):
    n = len(data)
    x = np.arange(n)
    bar_w = 0.38

    actual = [d['avgRate'] for d in data]
    targets = calc_dynamic_targets(data)
    colors = [get_color(d['cultivar_short']) for d in data]

    target_vals = [t if t is not None else 0 for t in targets]
    ax.bar(x - bar_w/2, target_vals, bar_w, color='#1B3A4B', edgecolor='#0D2330',
           linewidth=0.6, zorder=2)
    bars_a = ax.bar(x + bar_w/2, actual, bar_w, color=colors,
                    edgecolor=['#000' for _ in colors], linewidth=0.3, zorder=2)

    for bar, val in zip(bars_a, actual):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.015,
                f'{val:.2f}', ha='center', va='bottom', fontsize=DATA_LABEL_SIZE,
                fontweight='bold', color='#111')

    trend = linear_trend(actual)
    ax.plot(x, trend, '--', color='#222', linewidth=1.8, zorder=3)

    ax.set_xticks(x)
    ax.set_xticklabels(make_x_labels(data), fontsize=TICK_SIZE, ha='center', linespacing=1.3)
    ax.set_ylabel('Rate (lbs/hr)', fontsize=AXIS_LABEL_SIZE, fontweight='bold')
    ax.set_title(f'{month_label}', fontsize=SUBTITLE_SIZE, fontweight='bold', pad=10, loc='left')

    valid_targets = [t for t in targets if t is not None]
    y_max = max(max(actual), max(valid_targets) if valid_targets else 0) + 0.25
    ax.set_ylim(0, y_max)
    style_axes(ax)

    avg = sum(actual) / len(actual)
    ax.text(0.99, 0.95, f'Avg: {avg:.2f} lbs/hr', transform=ax.transAxes,
            ha='right', va='top', fontsize=BADGE_SIZE, fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.4', facecolor='#E8EDF5', edgecolor='#90A4AE', linewidth=1.2))

    legend_elements = [
        Patch(facecolor='#1B3A4B', edgecolor='#0D2330', label='Target'),
        Patch(facecolor='#C62828', edgecolor='#000', label='Lifter'),
        Patch(facecolor='#1565C0', edgecolor='#000', label='GOG/POG'),
        Patch(facecolor='#757575', edgecolor='#000', label='Unknown'),
        plt.Line2D([0], [0], linestyle='--', color='#222', linewidth=1.8, label='Trend'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=LEGEND_SIZE, ncol=5,
              framealpha=0.95, edgecolor='#aaa', handlelength=1.5, handletextpad=0.5,
              borderpad=0.4, columnspacing=1.0)


def draw_lbs_per_operator(ax, data, month_label):
    n = len(data)
    x = np.arange(n)
    lbs_per_op = []
    for d in data:
        crew = d.get('totalCrew', 0) or d.get('operatorHours', 0)
        lbs_per_op.append(d['totalLbs'] / crew if crew > 0 else 0)
    colors = [get_color(d['cultivar_short']) for d in data]

    bars = ax.bar(x, lbs_per_op, 0.65, color=colors, edgecolor=['#000' for _ in colors],
                  linewidth=0.3, zorder=2)

    for bar, val in zip(bars, lbs_per_op):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.02,
                f'{val:.1f}', ha='center', va='bottom', fontsize=DATA_LABEL_SIZE,
                fontweight='bold', color='#111')

    trend = linear_trend(lbs_per_op)
    ax.plot(x, trend, '--', color='#222', linewidth=1.8, zorder=3)

    ax.set_xticks(x)
    ax.set_xticklabels(make_x_labels(data), fontsize=TICK_SIZE, ha='center', linespacing=1.3)
    ax.set_ylabel('Lbs per Operator', fontsize=AXIS_LABEL_SIZE, fontweight='bold')
    ax.set_title(f'{month_label}', fontsize=SUBTITLE_SIZE, fontweight='bold', pad=10, loc='left')

    y_max = max(lbs_per_op) + 0.5 if lbs_per_op else 1
    ax.set_ylim(0, y_max)
    style_axes(ax)

    avg = sum(lbs_per_op) / len(lbs_per_op)
    ax.text(0.99, 0.95, f'Avg: {avg:.1f} lbs/op', transform=ax.transAxes,
            ha='right', va='top', fontsize=BADGE_SIZE, fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.4', facecolor='#E8EDF5', edgecolor='#90A4AE', linewidth=1.2))

    legend_elements = [
        Patch(facecolor='#C62828', edgecolor='#000', label='Lifter'),
        Patch(facecolor='#1565C0', edgecolor='#000', label='GOG/POG'),
        Patch(facecolor='#757575', edgecolor='#000', label='Unknown'),
        plt.Line2D([0], [0], linestyle='--', color='#222', linewidth=1.8, label='Trend'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=LEGEND_SIZE, ncol=4,
              framealpha=0.95, edgecolor='#aaa', handlelength=1.5, handletextpad=0.5,
              borderpad=0.4, columnspacing=1.0)


def draw_cost_variance(ax, data, month_label):
    variances = calc_cost_variance(data)
    plot_data = [(d, v) for d, v in zip(data, variances) if v is not None]
    if not plot_data:
        ax.set_visible(False)
        return

    days = [p[0] for p in plot_data]
    vals = [p[1] for p in plot_data]
    n = len(vals)
    x = np.arange(n)

    colors_map = []
    for v in vals:
        absv = abs(v)
        if absv <= 5:
            colors_map.append('#2E7D32')
        elif absv <= 10:
            colors_map.append('#F9A825')
        else:
            colors_map.append('#C62828')

    bars = ax.bar(x, vals, 0.65, color=colors_map,
                  edgecolor=['#000' for _ in colors_map], linewidth=0.3, zorder=2)

    for bar, val in zip(bars, vals):
        offset = 0.5 if val >= 0 else -0.5
        va = 'bottom' if val >= 0 else 'top'
        sign = '+' if val > 0 else ''
        ax.text(bar.get_x() + bar.get_width()/2, val + offset,
                f'{sign}{val:.1f}%', ha='center', va=va, fontsize=DATA_LABEL_SIZE,
                fontweight='bold', color='#111')

    ax.axhline(y=0, color='#222', linewidth=1.5, zorder=1)

    ax.set_xticks(x)
    ax.set_xticklabels(make_x_labels(days), fontsize=TICK_SIZE, ha='center', linespacing=1.3)
    ax.set_ylabel('Variance from 7-Day Baseline (%)', fontsize=AXIS_LABEL_SIZE, fontweight='bold')
    ax.set_title(f'{month_label}', fontsize=SUBTITLE_SIZE, fontweight='bold', pad=10, loc='left')

    abs_max = max(abs(v) for v in vals)
    bound = int(np.ceil((abs_max + 5) / 5) * 5)
    ax.set_ylim(-bound, bound)
    style_axes(ax)

    avg_abs = sum(abs(v) for v in vals) / len(vals)
    ax.text(0.99, 0.95, f'Avg Variance: \u00B1{avg_abs:.1f}%', transform=ax.transAxes,
            ha='right', va='top', fontsize=BADGE_SIZE, fontweight='bold',
            bbox=dict(boxstyle='round,pad=0.4', facecolor='#E8EDF5', edgecolor='#90A4AE', linewidth=1.2))

    legend_elements = [
        Patch(facecolor='#2E7D32', edgecolor='#000', label='< 5%'),
        Patch(facecolor='#F9A825', edgecolor='#000', label='5-10%'),
        Patch(facecolor='#C62828', edgecolor='#000', label='> 10%'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=LEGEND_SIZE, ncol=3,
              framealpha=0.95, edgecolor='#aaa', handlelength=1.5, handletextpad=0.5,
              borderpad=0.4, columnspacing=1.0)


# ── BUILD PDF ────────────────────────────────────────────────────────────────

def generate_pdf(daily, output_path):
    months = split_by_month(daily)

    if len(months) < 2:
        print(f'Warning: Only {len(months)} month(s) of data. Charts may look sparse.')

    PAGE_W, PAGE_H = 14, 8.5

    chart_configs = [
        ('Production Rate: Target vs. Actual (lbs/hr)', draw_production_rate),
        ('Lbs per Operator per Day by Strain', draw_lbs_per_operator),
        ('Daily Cost Variance (Predictability)', draw_cost_variance),
    ]

    with PdfPages(output_path) as pdf:
        for title, draw_fn in chart_configs:
            n_months = len(months)
            fig, axes = plt.subplots(n_months, 1, figsize=(PAGE_W, PAGE_H),
                                     squeeze=False)
            fig.suptitle(f'ROGUE ORIGIN \u2014 {title}',
                         fontsize=SUPTITLE_SIZE, fontweight='bold', color='#1B3A4B', y=0.99)

            for i, (label, data) in enumerate(months):
                draw_fn(axes[i, 0], data, label)

            plt.subplots_adjust(left=0.05, right=0.97, top=0.92, bottom=0.08, hspace=0.42)
            pdf.savefig(fig, orientation='landscape')
            plt.close(fig)

    print(f'PDF saved: {output_path}')
    return output_path


# ── EMAIL ────────────────────────────────────────────────────────────────────

def send_email(pdf_path, resend_key):
    """Send PDF via Resend API."""
    import base64

    with open(pdf_path, 'rb') as f:
        pdf_b64 = base64.b64encode(f.read()).decode()

    today = datetime.now().strftime('%B %d, %Y')
    filename = os.path.basename(pdf_path)

    payload = json.dumps({
        'from': EMAIL_FROM,
        'to': [EMAIL_TO],
        'subject': f'SQDCP Production Charts - {today}',
        'html': f'<p>Weekly production charts attached for the SQDCP board.</p><p>Generated {today}.</p>',
        'attachments': [{
            'filename': filename,
            'content': pdf_b64,
        }]
    }).encode()

    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=payload,
        headers={
            'Authorization': f'Bearer {resend_key}',
            'Content-Type': 'application/json',
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            print(f'Email sent: {result.get("id", "ok")}')
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f'Resend API error {e.code}: {body}')
        sys.exit(1)


# ── MAIN ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Generate SQDCP production charts')
    parser.add_argument('--email', action='store_true', help='Email the PDF after generation')
    parser.add_argument('--resend-key', default=os.environ.get('RESEND_API_KEY', ''),
                        help='Resend API key (or set RESEND_API_KEY env var)')
    parser.add_argument('--output', default=None,
                        help='Output PDF path (default: auto-named on Desktop)')
    args = parser.parse_args()

    # Auto-name output file
    if args.output:
        output_path = args.output
    else:
        today = datetime.now()
        first_of_current = today.replace(day=1)
        prior = (first_of_current - timedelta(days=1))
        name = f'Rogue_Origin_Production_{prior.strftime("%b")}_{today.strftime("%b")}_{today.year}.pdf'
        output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', name)
        # For GitHub Actions, use workspace root
        if os.environ.get('GITHUB_WORKSPACE'):
            output_path = os.path.join(os.environ['GITHUB_WORKSPACE'], name)

    daily = fetch_production_data()
    pdf_path = generate_pdf(daily, output_path)

    if args.email:
        key = args.resend_key
        if not key:
            print('ERROR: --resend-key or RESEND_API_KEY env var required for email')
            sys.exit(1)
        send_email(pdf_path, key)
