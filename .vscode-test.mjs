import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out-test/**/*.test.js',
  version: 'stable',
  workspaceFolder: 'test/fixtures/integration-workspace',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome'],
  mocha: {
    ui: 'bdd',
    timeout: 120000,
  },
});
