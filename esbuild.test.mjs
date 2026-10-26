import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['test/integration/run.ts'],
  bundle: true,
  outfile: 'out-test/run.test.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  logLevel: 'info',
});
