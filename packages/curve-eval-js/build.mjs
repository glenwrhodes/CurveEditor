import * as esbuild from 'esbuild';

const shared = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  sourcemap: true,
  target: 'es2020',
  minify: true,
};

await Promise.all([
  esbuild.build({ ...shared, outfile: 'dist/index.mjs', format: 'esm' }),
  esbuild.build({ ...shared, outfile: 'dist/index.cjs', format: 'cjs' }),
]);

// Generate declarations via tsc
import { execSync } from 'child_process';
execSync('npx tsc --emitDeclarationOnly', { stdio: 'inherit' });
