/**
 * `npm run dev` (or ▶ in VS Code) — opens the FlightX window with live reload.
 *
 *  - Vite serves the UI with hot module reload (edits in src/ appear instantly).
 *  - esbuild watches electron/ + server/ and restarts the app when they change.
 */
import { context } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { brandedElectron } from './branded-electron.mjs';
import { mainBuildOptions } from './electron-build.mjs';

const API_PORT = process.env.PORT ?? '8787';
process.env.PORT = API_PORT; // read by vite.config.ts for the /api proxy

const vite = await createServer({ server: { port: 5173, strictPort: true } });
await vite.listen();
const devUrl = 'http://localhost:5173/';

const env = { ...process.env, FLIGHTX_DEV_URL: devUrl, PORT: API_PORT, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
// VS Code sets ELECTRON_RUN_AS_NODE in some environments, which would make Electron act
// like plain Node and never open a window. Its debugger also injects NODE_OPTIONS hooks
// meant for Node processes; keep those out of the Electron app.
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
delete env.VSCODE_INSPECTOR_OPTIONS;

/** Electron runtime branded as "FlightX" with the plane icon (macOS Dock / menu bar). */
const electronBinary = brandedElectron();

let child = null;
let restarting = false;

function launch() {
  child = spawn(electronBinary, ['.'], { stdio: 'inherit', env });
  child.on('exit', (code) => {
    if (restarting) return;
    // Window closed / app quit → stop the dev session.
    void vite.close().finally(() => process.exit(code ?? 0));
  });
}

function relaunch() {
  if (!child) return launch();
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    launch();
  });
  child.kill();
}

const ctx = await context({
  ...mainBuildOptions,
  plugins: [
    {
      name: 'relaunch-electron',
      setup(b) {
        let first = true;
        b.onEnd((result) => {
          if (result.errors.length) return;
          if (!first) console.log('[dev] main process changed — restarting FlightX');
          first = false;
          relaunch();
        });
      },
    },
  ],
});
await ctx.watch();

const shutdown = () => {
  restarting = true;
  child?.kill();
  void ctx.dispose();
  void vite.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
