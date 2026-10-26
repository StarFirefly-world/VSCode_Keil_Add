module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    node: true,
    es2022: true,
    mocha: true,
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'out/',
    'out-test/',
    'coverage/',
    '.vscode-test/',
  ],
  rules: {
    'no-control-regex': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
  },
};
