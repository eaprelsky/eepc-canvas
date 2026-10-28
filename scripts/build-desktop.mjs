// Packages the Vite build as a Windows desktop app via Neutralino.
// Usage: npm run build:desktop  (runs `vite build` first, then this script).
//
// Neutralino binaries are downloaded once by `neu update`; the client library
// is cached under desktop/.client-cache so re-builds need no network.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const desktop = path.join(root, 'desktop');
const desktopResources = path.join(desktop, 'resources');

if (!existsSync(dist)) {
  console.error('No dist/ found. Run `npm run build` first.');
  process.exit(1);
}

rmSync(desktopResources, { recursive: true, force: true });
mkdirSync(desktopResources, { recursive: true });
cpSync(dist, desktopResources, { recursive: true });
console.log(`Copied ${dist} -> ${desktopResources}`);

const neu = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => {
  const result = spawnSync(neu, args, { stdio: 'inherit', cwd: desktop, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// 1. Platform binaries: download only when missing (the archive is ~8 MB).
const platformBin = process.platform === 'win32' ? 'neutralino-win_x64.exe' : 'neutralino-linux_x64';
if (!existsSync(path.join(desktop, 'bin', platformBin))) {
  console.log('Neutralino binaries not found, running neu update...');
  run(['neu', 'update']);
} else {
  console.log('Neutralino binaries found, skipping update.');
}

// 2. Client library (not used at runtime, but bundled for completeness).
const config = JSON.parse(readFileSync(path.join(desktop, 'neutralino.config.json'), 'utf-8'));
const clientVersion = config.cli?.clientVersion ?? '6.10.0';
const cacheDir = path.join(desktop, '.client-cache');
const clientCache = path.join(cacheDir, 'neutralino.js');
try {
  if (!existsSync(clientCache)) {
    mkdirSync(cacheDir, { recursive: true });
    const url = `https://github.com/neutralinojs/neutralino.js/releases/download/v${clientVersion}/neutralino.js`;
    const res = await fetch(url);
    if (res.ok) {
      writeFileSync(clientCache, Buffer.from(await res.arrayBuffer()));
      console.log(`Downloaded Neutralino client v${clientVersion}.`);
    }
  }
  if (existsSync(clientCache)) {
    cpSync(clientCache, path.join(desktopResources, 'neutralino.js'));
  }
} catch (e) {
  console.warn(`Client library skipped: ${e instanceof Error ? e.message : String(e)}`);
}

console.log('Building desktop app...');
run(['neu', 'build', '--release']);
console.log('Done. Release is in desktop/dist/');
