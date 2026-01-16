// ESLint flat config for Rogue Origin Apps
// https://eslint.org/docs/latest/use/configure/configuration-files-new

export default [
  {
    // Global ignore patterns
    ignores: [
      'node_modules/**',
      'archive/**',
      'docs/**',
      'tests/**',
      'test-*.js',
      'sw.js',
      'src/js/legacy/**',
      '*.min.js',
      'playwright.config.js',
      'kanban-script.js',
      'apps-script/**/*.js'
    ]
  },
  {
    // Apply to all JavaScript files
    files: ['**/*.js'],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',

      globals: {
        // Browser globals
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
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        navigator: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        Blob: 'readonly',
        Audio: 'readonly',

        // Third-party libraries
        google: 'readonly',         // Google Apps Script
        Chart: 'readonly',          // Chart.js
        ChartDataLabels: 'readonly', // Chart.js Data Labels plugin
        Muuri: 'readonly',          // Muuri.js

        // Service Worker globals (for sw.js if not ignored)
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        registration: 'readonly'
      }
    },

    rules: {
      // Possible Problems
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
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

      // Best Practices
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',
      'no-self-assign': 'warn',
      'no-self-compare': 'warn',
      'no-useless-return': 'warn',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'warn',

      // Variables
      'no-delete-var': 'error',
      'no-label-var': 'error',
      'no-shadow-restricted-names': 'error',

      // Stylistic (minimal - focus on consistency)
      'no-mixed-spaces-and-tabs': 'error',
      'no-trailing-spaces': 'warn',
      'semi': ['warn', 'always'],
      'quotes': ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }],

      // ES6
      'no-const-assign': 'error',
      'no-duplicate-imports': 'warn',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'prefer-template': 'warn',
      'template-curly-spacing': ['warn', 'never'],

      // Allow console (needed for debugging)
      'no-console': 'off'
    }
  },
  {
    // Special config for scoreboard files
    files: ['src/js/scoreboard/**/*.js'],
    languageOptions: {
      globals: {
        // Scoreboard-specific globals
        ScoreboardState: 'readonly',
        ScoreboardTimer: 'readonly',
        ScoreboardAPI: 'readonly',
        ScoreboardRender: 'readonly',
        ScoreboardShiftStart: 'readonly',
        ScoreboardDOM: 'readonly',
        confetti: 'readonly'
      }
    }
  },
  {
    // Special config for Apps Script files
    files: ['apps-script/**/*.gs'],
    rules: {
      // Apps Script uses .gs extension and may have different patterns
      'no-undef': 'off'  // Apps Script has many global functions
    }
  }
];
