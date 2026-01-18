module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // === ERRORS (must fix) ===
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'eqeqeq': ['error', 'always'],

    // === SECURITY ===
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',

    // === CODE QUALITY ===
    'no-var': 'error',
    'prefer-const': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
    'curly': ['error', 'all'],
    'default-case': 'error',
    'no-fallthrough': 'error',

    // === ASYNC ===
    'no-async-promise-executor': 'error',
    'no-await-in-loop': 'warn',
    'require-await': 'error',
    'no-return-await': 'error',

    // === STYLE (warnings) ===
    'no-multiple-empty-lines': ['warn', { max: 2 }],
    'no-trailing-spaces': 'warn',
    'comma-dangle': ['warn', 'always-multiline'],
    'semi': ['warn', 'always'],
  },
};
