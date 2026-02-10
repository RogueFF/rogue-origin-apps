/**
 * Configuration Module
 * Central configuration for KPIs, widgets, URLs, and brand colors
 */

// KPI Definitions with custom minimal SVG icons
// Note: 'visible' is initialized from 'default' and can be mutated at runtime
export const kpiDefinitions = [
  { id: 'totalTops', label: 'Total Tops', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 18c0 0-7-4-7-10C3 4 6.5 2 10 2s7 2 7 6c0 6-7 10-7 10z"/><path d="M10 2v16"/></svg>', color: 'gold', default: true, visible: true, format: 'lbs' },
  { id: 'totalSmalls', label: 'Total Smalls', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 16c0 0-5-3-5-8 0-3 2.2-4.5 5-4.5s5 1.5 5 4.5c0 5-5 8-5 8z"/><path d="M10 3.5v12.5"/></svg>', color: 'sungrown', default: true, visible: true, format: 'lbs' },
  { id: 'avgRate', label: 'Lbs/Trimmer/Hr', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a7 7 0 1 1 14 0"/><path d="M10 14l3-5"/><path d="M10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>', color: 'green', default: true, visible: true, format: 'rate' },
  { id: 'crew', label: 'Current Trimmers', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="6" r="2.5"/><path d="M2 17v-1.5A3.5 3.5 0 0 1 5.5 12h3A3.5 3.5 0 0 1 12 15.5V17"/><circle cx="14" cy="7" r="2"/><path d="M14.5 12.5a3 3 0 0 1 3 3V17"/></svg>', color: 'greenhouse', default: true, visible: true, format: 'num' },
  { id: 'operatorHours', label: 'Operator Hours', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 5v5l3.5 2"/></svg>', color: 'indoor', default: true, visible: true, format: 'hrs' },
  { id: 'costPerLb', label: 'Cost/Lb (Blend)', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v14"/><path d="M13.5 6.5c0-1.4-1.6-2.5-3.5-2.5S6.5 5.1 6.5 6.5 8.1 9 10 9s3.5 1.1 3.5 2.5-1.6 2.5-3.5 2.5-3.5-1.1-3.5-2.5"/></svg>', color: 'indoor', default: false, visible: false, format: 'dollar' },
  { id: 'topsCostPerLb', label: 'Tops Cost/Lb', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v14"/><path d="M12.5 6.5c0-1.4-1.6-2.5-3.5-2.5S5.5 5.1 5.5 6.5 7.1 9 9 9s3.5 1.1 3.5 2.5-1.6 2.5-3.5 2.5-3.5-1.1-3.5-2.5"/><path d="M16 8V4m0 0l-2 2m2-2l2 2"/></svg>', color: 'gold', default: true, visible: true, format: 'dollar' },
  { id: 'smallsCostPerLb', label: 'Smalls Cost/Lb', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v14"/><path d="M12.5 6.5c0-1.4-1.6-2.5-3.5-2.5S5.5 5.1 5.5 6.5 7.1 9 9 9s3.5 1.1 3.5 2.5-1.6 2.5-3.5 2.5-3.5-1.1-3.5-2.5"/><path d="M16 4v4m0 0l-2-2m2 2l2-2"/></svg>', color: 'sungrown', default: true, visible: true, format: 'dollar' },
  { id: 'totalLbs', label: 'Total Lbs', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17h12l-1.5-8h-9z"/><circle cx="10" cy="6" r="3"/></svg>', color: 'green', default: false, visible: false, format: 'lbs' },
  { id: 'maxRate', label: 'Best Rate', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/><path d="M10 3v2m0 10v2M3 10h2m10 0h2"/></svg>', color: 'gold', default: false, visible: false, format: 'rate' },
  { id: 'trimmerHours', label: 'Trimmer Hours', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="14" r="2.5"/><path d="M8.2 7.8L17 14M8.2 12.2L17 6"/></svg>', color: 'greenhouse', default: false, visible: false, format: 'hrs' },
  { id: 'laborCost', label: 'Total Labor', icon: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><path d="M10 6v8"/><path d="M12.5 8c0-1.1-1.1-2-2.5-2s-2.5.9-2.5 2 1.1 2 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2-2.5-.9-2.5-2"/></svg>', color: 'sungrown', default: false, visible: false, format: 'dollar' }
];

// Widget Definitions (icons used in settings toggle panel)
// Note: 'visible' is initialized from 'default' and can be mutated at runtime
export const widgetDefinitions = [
  { id: 'kanban', label: 'Supply Kanban', icon: 'ph-duotone ph-package', color: 'green', default: false, visible: false },
  { id: 'scoreboard', label: 'Live Scoreboard', icon: 'ph-duotone ph-gauge', color: 'gold', default: false, visible: false },
  { id: 'bags', label: '5KG Bag Timer', icon: 'ph-duotone ph-timer', color: 'sungrown', default: false, visible: false },
  { id: 'sop', label: 'SOP Manager', icon: 'ph-duotone ph-book-open-text', color: 'indoor', default: false, visible: false },
  { id: 'current', label: 'Current Production', icon: 'ph-duotone ph-pulse', color: 'green', default: true, visible: true },
  { id: 'hourlyChart', label: 'Hourly Chart', icon: 'ph-duotone ph-chart-bar', color: 'indoor', default: true, visible: true },
  { id: 'rateChart', label: 'Rate Chart', icon: 'ph-duotone ph-trend-up', color: 'indoor', default: true, visible: true },
  { id: 'dailyChart', label: 'Daily Chart', icon: 'ph-duotone ph-chart-bar-horizontal', color: 'indoor', default: true, visible: true },
  { id: 'dailyRateChart', label: 'Daily Rate Chart', icon: 'ph-duotone ph-chart-line-up', color: 'indoor', default: true, visible: true },
  { id: 'trimmersChart', label: 'Trimmers on Line', icon: 'ph-duotone ph-users', color: 'greenhouse', default: true, visible: true },
  { id: 'productivity', label: 'Productivity Sparkline', icon: 'ph-duotone ph-lightning', color: 'green', default: true, visible: true },
  { id: 'strains', label: 'Strain Breakdown', icon: 'ph-duotone ph-leaf', color: 'greenhouse', default: true, visible: true },
  { id: 'performance', label: 'Performance Table', icon: 'ph-duotone ph-list-checks', color: 'indoor', default: true, visible: true },
  { id: 'cost', label: 'Cost Analysis', icon: 'ph-duotone ph-currency-dollar', color: 'gold', default: true, visible: true },
  { id: 'period', label: 'Period Summary', icon: 'ph-duotone ph-calendar', color: 'sungrown', default: true, visible: true }
];

// App URLs for embedded iframes
export const appUrls = {
  kanban: 'https://rogueff.github.io/rogue-origin-apps/src/pages/kanban.html',
  scoreboard: 'https://rogueff.github.io/rogue-origin-apps/src/pages/scoreboard.html',
  barcode: 'https://rogueff.github.io/rogue-origin-apps/src/pages/barcode.html',
  sop: 'https://rogueff.github.io/rogue-origin-apps/src/pages/sop-manager.html',
  orders: 'https://rogueff.github.io/rogue-origin-apps/src/pages/orders.html'
};

// Brand colors for charts and UI
export const brandColors = {
  green: '#668971',
  greenLight: 'rgba(102,137,113,0.2)',
  gold: '#e4aa4f',
  goldLight: 'rgba(228,170,79,0.2)',
  sungrown: '#bf8e4e',
  indoor: '#62758d',
  indoorLight: 'rgba(98,117,141,0.3)',
  danger: 'rgba(196,92,74,0.6)'
};

// API Configuration
// Cloudflare Workers (100K free requests/day, no cold starts)
export const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
// Vercel Functions (backup - rate limited)
// export const API_BASE = 'https://rogue-origin-apps-master.vercel.app/api';

// Endpoint URLs
export const API_URL = `${API_BASE}/production`;

// Work schedule configuration
// Day: 7:00 AM - 4:30 PM (9.5 hours)
// Breaks: 9:00 AM (10min), 12:00 PM (30min lunch), 2:30 PM (10min), 4:20 PM (10min cleanup)
// Total break time: 60 min = 1 hour
// Total productive time: 8.5 hours
export const workSchedule = {
  startHour: 7,
  startMin: 0,     // 7:00 AM
  endHour: 16,
  endMin: 30,      // 4:30 PM
  breaks: [
    { hour: 9, min: 0, duration: 10 },    // 9:00 AM - 10 min
    { hour: 12, min: 0, duration: 30 },   // 12:00 PM - 30 min lunch
    { hour: 14, min: 30, duration: 10 },  // 2:30 PM - 10 min
    { hour: 16, min: 20, duration: 10 }   // 4:20 PM - 10 min cleanup
  ],
  totalProductiveMinutes: 8.5 * 60  // 510 minutes
};

// Default daily production target in lbs
export const DEFAULT_DAILY_TARGET = 200;
