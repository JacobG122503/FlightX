/**
 * Bundles the Electron main process (and the API server it embeds) into a
 * single file with esbuild, so the packaged app needs no node_modules.
 * Run directly to build once: `node scripts/electron-build.mjs`.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const mainBuildOptions = {
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build({ ...mainBuildOptions, minify: true });
  console.log('Built dist-electron/main.cjs');
}
