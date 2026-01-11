// ESLint v9+ configuration
export default [
  {
    files: ['src/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        alert: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        Audio: 'readonly',
        Chart: 'readonly',
        Muuri: 'readonly',
        ChartDataLabels: 'readonly',
        google: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-console': 'off',
      'no-undef': 'warn',
      'semi': ['error', 'always'],
      'quotes': ['warn', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: true
      }]
    }
  }
];
