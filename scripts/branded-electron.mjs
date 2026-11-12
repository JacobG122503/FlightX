/**
 * macOS: a copy of the Electron runtime named "FlightX" with the FlightX plane icon,
 * so the Dock and menu bar show FlightX instead of "Electron". Made once (and again
 * whenever Electron or the icon changes) under node_modules/.flightx/, ad-hoc signed
 * so macOS will run it. Falls back to the stock Electron if anything goes wrong.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import electronPath from 'electron';

export function brandedElectron() {
  if (process.platform !== 'darwin') return electronPath;
  try {
    const root = path.resolve('node_modules/.flightx');
    const app = path.join(root, 'FlightX.app');
    const icon = path.resolve('assets/icon.png');
    const version = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version;
    const stamp = `${version}|${statSync(icon).mtimeMs}`;
    const stampFile = path.join(root, 'stamp.txt');
    const binary = path.join(app, 'Contents/MacOS/Electron');

    if (!existsSync(binary) || !existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== stamp) {
      console.log('[dev] preparing the FlightX app icon (first run only)…');
      rmSync(root, { recursive: true, force: true });
      mkdirSync(root, { recursive: true });
      const source = path.join(path.dirname(electronPath), '..', '..'); // …/Electron.app
      execFileSync('ditto', [source, app]);
      const plist = path.join(app, 'Contents/Info.plist');
      for (const [key, value] of [
        ['CFBundleName', 'FlightX'],
        ['CFBundleDisplayName', 'FlightX'],
        ['CFBundleIdentifier', 'dev.flightx.app'],
      ]) {
        execFileSync('plutil', ['-replace', key, '-string', value, plist]);
      }
      // Build a proper .icns from the PNG: an .iconset of resized copies, then iconutil.
      const iconset = path.join(root, 'icon.iconset');
      mkdirSync(iconset);
      for (const size of [16, 32, 128, 256, 512]) {
        for (const scale of [1, 2]) {
          const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
          execFileSync('sips', ['-z', String(size * scale), String(size * scale), icon, '--out', path.join(iconset, name)], { stdio: 'ignore' });
        }
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(app, 'Contents/Resources/electron.icns')]);
      rmSync(iconset, { recursive: true, force: true });
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });
      writeFileSync(stampFile, stamp);
    }
    return binary;
  } catch (err) {
    console.warn(`[dev] couldn't brand the app icon (${err instanceof Error ? err.message : err}); using plain Electron`);
    return electronPath;
  }
}
