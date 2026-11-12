/**
 * FlightX window (Electron main process), launched by `npm run dev` / ▶ in VS Code.
 *
 * Starts the flight-data API in-process, then opens a window on the UI served
 * by the Vite dev server (hot reload). If run without the dev server, it falls
 * back to the built UI in dist/ (after `npm run build`).
 */
import './env';
import { app, BrowserWindow, Menu, shell, screen, type MenuItemConstructorOptions } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { startServer } from '../server/app';

/** Set by scripts/dev.mjs when running against the Vite dev server. */
const DEV_URL = process.env.FLIGHTX_DEV_URL || null;
const DEFAULT_PORT = Number(process.env.PORT ?? 8787);

// Optional: FLIGHTX_DEBUG_PORT=9333 lets Chrome DevTools / automation attach to the window.
if (process.env.FLIGHTX_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.FLIGHTX_DEBUG_PORT);

let mainWindow: BrowserWindow | null = null;
let serverPort: Promise<number> | null = null;

/** The API server starts once per app run, however many times a window is (re)created. */
function ensureServer(): Promise<number> {
  serverPort ??= startServer({
    port: DEFAULT_PORT,
    staticDir: DEV_URL ? null : path.join(app.getAppPath(), 'dist'),
    // In dev, Vite's proxy expects this exact port.
    strictPort: Boolean(DEV_URL),
  });
  return serverPort;
}

// ── Window size/position memory ──────────────────────────────────────────
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized?: boolean;
}
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): WindowState {
  const fallback: WindowState = { width: 1440, height: 900 };
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as WindowState;
    // Ignore saved positions that are now off-screen (e.g. a disconnected monitor).
    const visible = screen.getAllDisplays().some(({ workArea: a }) =>
      s.x != null && s.y != null && s.x < a.x + a.width && s.x + s.width > a.x && s.y < a.y + a.height && s.y + s.height > a.y,
    );
    return visible ? s : { ...fallback, width: s.width, height: s.height };
  } catch {
    return fallback;
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {
    /* non-critical */
  }
}

// ── Menu ─────────────────────────────────────────────────────────────────
function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Window ───────────────────────────────────────────────────────────────
async function createWindow() {
  const port = await ensureServer();
  const appUrl = DEV_URL ?? `http://localhost:${port}/`;
  const appOrigin = new URL(appUrl).origin;

  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 1024,
    minHeight: 640,
    title: 'FlightX',
    backgroundColor: '#0b0f17',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 28 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => {
    mainWindow = null;
  });

  // Links (photo credits, data sources) open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== appOrigin) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });

  // A reload during the first load (Vite reloading after a file save, ⌘R) rejects this
  // promise with ERR_ABORTED. That's harmless — the newer load continues — so never quit over it.
  win.loadURL(appUrl).catch((err: Error) => console.warn(`[flightx] page load interrupted: ${err.message}`));
}

// ── App lifecycle ────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setName('FlightX');
  app.whenReady().then(async () => {
    buildMenu();
    try {
      await createWindow();
    } catch (err) {
      console.error('[flightx] failed to start', err);
      app.quit();
    }
  });

  // macOS: clicking the Dock icon with no windows open reopens one.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) void createWindow().catch(() => app.quit());
  });

  // Quit when the window closes (the API server lives in this process).
  app.on('window-all-closed', () => app.quit());
}
