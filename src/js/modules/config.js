/**
 * Configuration Module
 * Central configuration for KPIs, widgets, URLs, and brand colors
 */

// KPI Definitions with Phosphor duotone icons
// Note: 'visible' is initialized from 'default' and can be mutated at runtime
export const kpiDefinitions = [
  { id: 'totalTops', label: 'Total Tops', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="11" rx="5" ry="7" stroke="currentColor" stroke-width="2"/><path d="M8 8C8 8 9 6 12 6C15 6 16 8 16 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 11C7 11 8.5 9 12 9C15.5 9 17 11 17 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8 14C8 14 9.5 12 12 12C14.5 12 16 14 16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 18V21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7.5" cy="9" r="0.8" fill="currentColor"/><circle cx="16.5" cy="9" r="0.8" fill="currentColor"/><circle cx="7" cy="12" r="0.8" fill="currentColor"/><circle cx="17" cy="12" r="0.8" fill="currentColor"/><circle cx="8" cy="15" r="0.8" fill="currentColor"/><circle cx="16" cy="15" r="0.8" fill="currentColor"/></svg>', color: 'gold', default: true, visible: true, format: 'lbs' },
  { id: 'totalSmalls', label: 'Total Smalls', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="9" rx="3" ry="4" stroke="currentColor" stroke-width="2"/><path d="M10 7C10 7 10.5 6 12 6C13.5 6 14 7 14 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 10C10 10 10.5 9 12 9C13.5 9 14 10 14 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="8" r="0.6" fill="currentColor"/><circle cx="14" cy="8" r="0.6" fill="currentColor"/><circle cx="10" cy="10.5" r="0.6" fill="currentColor"/><circle cx="14" cy="10.5" r="0.6" fill="currentColor"/><path d="M12 13L12 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 16L10 17M12 16L14 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', color: 'sungrown', default: true, visible: true, format: 'lbs' },
  { id: 'avgRate', label: 'Lbs/Trimmer/Hr', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3V21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 17C7 17 9 14 12 12C15 10 17 7 17 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 7C17 7 19 5 21 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="7" cy="17" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="17" cy="7" r="1.5" fill="currentColor"/></svg>', color: 'green', default: true, visible: true, format: 'rate' },
  { id: 'crew', label: 'Current Crew', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="7" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 21V19C8 17.9391 8.42143 16.9217 9.17157 16.1716C9.92172 15.4214 10.9391 15 12 15C13.0609 15 14.0783 15.4214 14.8284 16.1716C15.5786 16.9217 16 17.9391 16 19V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="5" cy="9" r="2" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="9" r="2" stroke="currentColor" stroke-width="2"/><path d="M12 3L13 2M12 3L11 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>', color: 'greenhouse', default: true, visible: true, format: 'num' },
  { id: 'operatorHours', label: 'Operator Hours', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 5V7M19 12H17M12 19V17M5 12H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 12V7M12 12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>', color: 'indoor', default: true, visible: true, format: 'hrs' },
  { id: 'costPerLb', label: 'Cost/Lb', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M15 9h-4.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'gold', default: true, visible: true, format: 'dollar' },
  { id: 'totalLbs', label: 'Total Lbs', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 21H19M12 21V8M4 8C4 8 8 7 12 8C16 9 20 8 20 8M4 8V11C4 12 5 13 7 13C9 13 10 12 10 11V8M14 8V11C14 12 15 13 17 13C19 13 20 12 20 11V8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="5" r="2" stroke="currentColor" stroke-width="2"/></svg>', color: 'green', default: false, visible: false, format: 'lbs' },
  { id: 'maxRate', label: 'Best Rate', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="2"/><path d="M12 8C12 8 10 9.5 10 12C10 9.5 8 8 8 8M12 8C12 8 14 9.5 14 12C14 9.5 16 8 16 8M12 12V15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'gold', default: false, visible: false, format: 'rate' },
  { id: 'trimmerHours', label: 'Trimmer Hours', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/><path d="M8.5 8L20 14M8.5 16L20 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 12C16 12 14.5 10.5 14.5 8.5M16 12C16 12 17.5 10.5 17.5 8.5M16 12V14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'greenhouse', default: false, visible: false, format: 'hrs' },
  { id: 'laborCost', label: 'Total Labor', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M15 9h-4.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', color: 'sungrown', default: false, visible: false, format: 'dollar' }
];

// Widget Definitions with Phosphor duotone icons
// Note: 'visible' is initialized from 'default' and can be mutated at runtime
export const widgetDefinitions = [
  { id: 'kanban', label: 'Supply Kanban', icon: 'ph-duotone ph-package', color: 'green', default: true, visible: true },
  { id: 'scoreboard', label: 'Live Scoreboard', icon: 'ph-duotone ph-gauge', color: 'gold', default: true, visible: true },
  { id: 'bags', label: '5KG Bag Timer', icon: 'ph-duotone ph-timer', color: 'sungrown', default: true, visible: true },
  { id: 'sop', label: 'SOP Manager', icon: 'ph-duotone ph-book-open-text', color: 'indoor', default: true, visible: true },
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
  kanban: 'https://rogueff.github.io/rogue-origin-apps/kanban.html',
  scoreboard: 'https://rogueff.github.io/rogue-origin-apps/scoreboard.html',
  barcode: 'https://rogueff.github.io/rogue-origin-apps/barcode.html',
  sop: 'https://rogueff.github.io/rogue-origin-apps/sop-manager.html',
  orders: 'https://rogueff.github.io/rogue-origin-apps/orders.html'
};

// Brand colors for charts and UI
export const brandColors = {
  green: '#668971',
  greenLight: 'rgba(102,137,113,0.2)',
  gold: '#e4aa4f',
  sungrown: '#bf8e4e',
  indoor: '#62758d',
  indoorLight: 'rgba(98,117,141,0.3)'
};

// API Configuration
export const API_URL = 'https://script.google.com/macros/s/AKfycbxDAHSFl9cedGS49L3Lf5ztqy-SSToYigyA30ZtsdpmWNAR9H61X_Mm48JOOTGqqr-Z/exec';

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
