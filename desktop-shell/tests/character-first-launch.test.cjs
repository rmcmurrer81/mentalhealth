'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..', 'desktop');
const sourceRoot = path.resolve(__dirname, '..', '..', 'src');
const main = fs.readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(desktopRoot, 'preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(sourceRoot, 'App.tsx'), 'utf8');

test('ordinary launch is compact and pinned while smoke and visual verification remain full-sized', () => {
  assert.match(main, /const initialWindowMode = smokeMode \|\| visualPreviewMode \? WINDOW_MODE\.FULL : WINDOW_MODE\.COMPACT/);
  assert.match(main, /setNativeWindowMode\(initialWindowMode\)/);
  assert.match(main, /initialRendererTarget\.searchParams\.set\('layout', initialWindowMode\)/);
  assert.match(app, /return layout === "full" \|\| layout === "character" \? layout : "compact"/);
  assert.match(app, /useState\(initialWindowLayoutRef\.current !== "full"\)/);
  assert.match(main, /setNativeAlwaysOnTop\(defaultAlwaysOnTopForMode\(mode\)\)/);
  assert.match(app, /const \[alwaysOnTop, setAlwaysOnTop\] = useState\(initialWindowLayoutRef\.current !== "full"\)/);
});

test('native tray changes and renderer presentation cannot drift apart', () => {
  assert.match(main, /webContents\.send\('wellbeing:window-mode-changed', mode\)/);
  assert.match(preload, /ipcRenderer\.on\('wellbeing:window-mode-changed', handler\)/);
  assert.match(preload, /mode === 'full' \|\| mode === 'compact' \|\| mode === 'character'/);
  assert.match(preload, /ipcRenderer\.removeListener\('wellbeing:window-mode-changed', handler\)/);
  assert.match(app, /onWindowModeChanged\?\.\(\(mode\) =>/);
  assert.match(app, /setAlwaysOnTop\(mode !== "full"\)/);
  assert.match(app, /setCompactPanel\(null\)/);
});
