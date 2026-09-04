// ESLint flat config for Rogue Origin Apps
// https://eslint.org/docs/latest/use/configure/configuration-files-new
//
// This repo runs code in three different runtimes, so globals are declared per
// runtime rather than as one browser-shaped set for everything. Declaring them
// centrally is what makes `no-undef` trustworthy: when it fires now it means a
// real undefined reference, not a missing environment entry.

// -- Browser: src/ pages and their modules -------------------------------
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  screen: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  Blob: 'readonly',
  File: 'readonly',
  FileReader: 'readonly',
  Image: 'readonly',
  Audio: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  MutationObserver: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  performance: 'readonly',
  crypto: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  speechSynthesis: 'readonly',
  SpeechSynthesisUtterance: 'readonly',
  Notification: 'readonly',
  XMLHttpRequest: 'readonly',
  WebSocket: 'readonly',
  Worker: 'readonly',
  // Service Worker scope (registration helpers)
  self: 'readonly',
  caches: 'readonly',
  clients: 'readonly',
  registration: 'readonly',
  // Third-party libraries loaded via <script>
  google: 'readonly',          // Google Apps Script client bridge
  Chart: 'readonly',           // Chart.js
  ChartDataLabels: 'readonly', // Chart.js Data Labels plugin
  Muuri: 'readonly',           // Muuri.js
};

// -- Cloudflare Workers: workers/ ----------------------------------------
const workerGlobals = {
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  fetch: 'readonly',
  caches: 'readonly',
  crypto: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  ReadableStream: 'readonly',
  WritableStream: 'readonly',
  TransformStream: 'readonly',
  Blob: 'readonly',
  FormData: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  structuredClone: 'readonly',
  addEventListener: 'readonly',
  WebSocketPair: 'readonly',
};

// -- Node: tools/, scripts/, the scale readers ---------------------------
const nodeGlobals = {
  process: 'readonly',
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly',
  clearTimeout: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  crypto: 'readonly',
};

export default [
  {
    // Global ignore patterns
    ignores: [
      'node_modules/**',
      '.claude/**',        // local agent config and skill templates, not project code
      '**/.wrangler/**',   // wrangler build cache (also under workers/)
      'Skills/**',         // authored skill catalog
      'docs/**',
      'tests/**',
      'test-results/**',
      'test-*.js',
      'sw.js',
      'src/js/legacy/**',
      'src/js/vendor/**',
      '*.min.js',
      'playwright.config.js',
      'apps-script/**/*.js',
    ],
  },
  {
    // Browser is the default runtime
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: {
      // -- Possible problems --
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-constant-condition': 'warn',
      'no-debugger': 'warn',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-empty': 'warn',
      'no-ex-assign': 'error',
      'no-extra-boolean-cast': 'warn',
      'no-func-assign': 'error',
      'no-unreachable': 'warn',

      // -- Best practices --
      eqeqeq: ['warn', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',
      'no-self-assign': 'warn',
      'no-self-compare': 'warn',
      'no-useless-return': 'warn',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'warn',

      // -- Variables --
      'no-delete-var': 'error',
      'no-label-var': 'error',
      'no-shadow-restricted-names': 'error',

      // -- ES6 --
      'no-const-assign': 'error',
      'no-duplicate-imports': 'warn',
      'prefer-const': 'warn',
      'template-curly-spacing': ['warn', 'never'],

      // -- Stylistic --
      // Only the rule catching a real hazard is kept. `quotes`, `no-var`,
      // `prefer-template`, `no-trailing-spaces` and `semi` were previously on
      // and produced ~22,600 warnings against code that has never followed
      // them, burying the ~220 unused-variable warnings worth reading. The
      // IIFE modules use `var` deliberately. Turn one back on only together
      // with the commit that actually fixes the code.
      'no-mixed-spaces-and-tabs': 'error',

      // Console output is intentional in operational tooling
      'no-console': 'off',
    },
  },
  {
    // Cloudflare Workers runtime
    files: ['workers/**/*.js', 'workers/**/*.mjs'],
    languageOptions: {
      globals: { ...workerGlobals, ...nodeGlobals },
    },
  },
  {
    // Node CLI tooling and the scale reader
    files: [
      'tools/**/*.js',
      'tools/**/*.mjs',
      'scripts/**/*.js',
      'scale-reader/**/*.js',
    ],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  {
    // atlas-notifications renderer: classic <script> tags sharing globals.
    // panel.html loads card-renderer.js before panel.js, so these exist at run
    // time even though nothing imports them.
    files: ['tools/atlas-notifications/src/renderer/**/*.js'],
    languageOptions: {
      globals: {
        ...browserGlobals,
        renderCard: 'readonly',
        renderSoundWave: 'readonly',
        escapeHtml: 'readonly',
        SVG_ICONS: 'readonly',
      },
    },
  },
  {
    // pdf-test drives a page through Playwright; the bodies of page.evaluate()
    // callbacks execute in the target page's scope, not Node's.
    files: ['tools/pdf-test/**/*.js'],
    languageOptions: {
      globals: {
        ...nodeGlobals,
        ...browserGlobals,
        // Declared by src/pages/sop-manager.html, the page under test
        sops: 'writable',
        currentSopId: 'writable',
        fetchPDFAssets: 'readonly',
        buildPDFHTML: 'readonly',
        getSopById: 'readonly',
      },
    },
  },
  {
    // Google Apps Script: .gs files rely on a large implicit global surface
    // (SpreadsheetApp, UrlFetchApp, Logger, ...) that is not worth enumerating.
    files: ['apps-script/**/*.gs'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // Scoreboard IIFE modules attach these to window
    files: ['src/js/scoreboard-v2/**/*.js'],
    languageOptions: {
      globals: {
        ScoreboardState: 'readonly',
        ScoreboardTimer: 'readonly',
        ScoreboardAPI: 'readonly',
        ScoreboardAPICache: 'readonly',
        ScoreboardChart: 'readonly',
        ScoreboardConfig: 'readonly',
        ScoreboardCycle: 'readonly',
        ScoreboardDOM: 'readonly',
        ScoreboardDebug: 'readonly',
        ScoreboardEvents: 'readonly',
        ScoreboardFABMenu: 'readonly',
        ScoreboardRender: 'readonly',
        ScoreboardScale: 'readonly',
        ScoreboardShiftStart: 'readonly',
        ScoreboardUtils: 'readonly',
        confetti: 'readonly',
      },
    },
  },
];
