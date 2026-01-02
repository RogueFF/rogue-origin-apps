# Rogue Origin Apps

A suite of web applications for cannabis cultivation and processing operations management.

## Applications

| Application | File | Description |
|-------------|------|-------------|
| **Operations Hub** | `index.html` | Main production dashboard with KPIs, efficiency charts, and trimmer productivity metrics |
| **Production Scoreboard** | `scoreboard.html` | Full-screen real-time status display with timers and color-coded production status |
| **SOP Manager** | `sop-manager.html` | Standard Operating Procedures management system |
| **Supply Kanban** | `kanban.html` | Kanban card system for supply closet inventory tracking |
| **Label Printer** | `barcode.html` | Barcode and label generator for cultivar identification |

## Features

- **Real-time dashboards** - Live production metrics and KPIs
- **Dark mode** - Toggle-able theme across all applications
- **Responsive design** - Works on desktop, tablet, and mobile
- **Multi-language support** - English and Spanish
- **Drag-and-drop** - Reorderable cards and panels
- **Print-ready** - Kanban cards and labels designed for printing

## Tech Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Charts**: Chart.js with datalabels plugin
- **Icons**: Phosphor Icons
- **Backend**: Google Apps Script + Google Sheets
- **Drag & Drop**: Sortable.js

## Setup

1. Clone the repository
2. Configure Google Apps Script endpoints in each application
3. Set up corresponding Google Sheets for data storage
4. Serve the HTML files via any web server

### Google Sheets Integration

Each application connects to Google Sheets via Apps Script endpoints:

- **Operations Hub**: Production metrics and trimmer data
- **SOP Manager**: Procedures, steps, and requests
- **Supply Kanban**: Inventory cards and supplier data
- **Label Printer**: Cultivar/strain information

## Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Gold | `#e4aa4f` | Primary accent |
| Green | `#668971` | Secondary accent |
| Sungrown | `#bf8e4e` | Cultivation method |
| Greenhouse | `#8f9263` | Cultivation method |
| Indoor | `#62758d` | Cultivation method |

## License

Proprietary - Rogue Origin
