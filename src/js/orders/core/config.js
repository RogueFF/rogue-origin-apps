/**
 * Application configuration constants
 * @module core/config
 */

// API Configuration
// Cloudflare Workers (100K free requests/day, no cold starts)
export const API_BASE = 'https://rogue-origin-api.roguefamilyfarms.workers.dev/api';
export const API_URL = `${API_BASE}/orders`;

// Backup: Vercel Functions (rate limited)
// export const API_BASE = 'https://rogue-origin-apps-master.vercel.app/api';

// Authentication
export const AUTH_STORAGE_KEY = 'orders_auth_session';
export const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Caching
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// PDF Libraries (lazy loaded)
export const PDF_LIBS = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js',
  pdfLib: 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js'
};

// Product Types
export const PRODUCT_TYPES = ['Tops', 'Smalls', 'Trim', 'Shake', 'Biomass'];

// Payment Methods
export const PAYMENT_METHODS = ['Wire', 'Check', 'ACH', 'Card'];

// Order Terms
export const ORDER_TERMS = [
  { value: 'DAP', label: 'DAP (Delivered at Place)' },
  { value: 'FOB', label: 'FOB (Free on Board)' },
  { value: 'EXW', label: 'EXW (Ex Works)' }
];

// Currencies
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];
