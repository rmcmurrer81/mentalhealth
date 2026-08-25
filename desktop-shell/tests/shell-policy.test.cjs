'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..', 'desktop');
const sourceRoot = path.resolve(__dirname, '..', '..', 'src');
const main = fs.readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(desktopRoot, 'preload.cjs'), 'utf8');
const localVoice = fs.readFileSync(path.join(desktopRoot, 'local-voice.cjs'), 'utf8');
const appSource = fs.readFileSync(path.join(sourceRoot, 'App.tsx'), 'utf8');

test('native shell has a working-title identity, fixed origin, tray, and isolated profile', () => {
  assert.match(main, /Wellbeing Companion — Working Title/);
  assert.match(main, /com\.kiralabs\.wellbeing-companion-working-title/);
  assert.match(main, /persist:wellbeing-companion-working-title/);
  assert.match(main, /new BrowserWindow/);
  assert.match(main, /new Tray/);
  assert.match(main, /app\.setPath\('userData'/);
  assert.match(main, /COMPANION_SMOKE_USER_DATA/);
  assert.doesNotMatch(main, /msedge|chrome\.exe|shell\.openPath/i);
});

test('renderer is sandboxed and the preload surface is narrow', () => {
  assert.match(main, /sandbox: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /webviewTag: false/);
  assert.match(main, /preload: path\.join\(__dirname, 'preload\.cjs'\)/);
  assert.match(preload, /requestHandsFreePermission/);
  assert.match(preload, /armMicrophone/);
  assert.match(preload, /disarmMicrophone/);
  assert.match(preload, /localVoice/);
  assert.match(preload, /localModel/);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|invoke)\([^'"`]/);
});

test('local voice exposes only fixed status, speak, and cancel IPC and no renderer provider internals', () => {
  assert.match(preload, /status: \(\) => ipcRenderer\.invoke\('wellbeing:local-voice-status'\)/);
  assert.match(preload, /speak: \(request\) => ipcRenderer\.invoke\('wellbeing:local-voice-speak', request\)/);
  assert.match(preload, /cancel: \(requestId\) => ipcRenderer\.invoke\('wellbeing:local-voice-cancel', requestId\)/);
  const preloadVoiceBlock = preload.slice(preload.indexOf('localVoice:'), preload.indexOf('localModel:'));
  assert.doesNotMatch(preloadVoiceBlock, /token|model|path|endpoint|providerId|speechSynthesis|SpeechSynthesisUtterance/i);
  assert.match(main, /registerLocalVoiceIpc/);
  assert.match(main, /approvedProviderId: null/);
  assert.match(localVoice, /createUnavailableLocalVoiceProvider/);
  assert.doesNotMatch(`${preload}\n${localVoice}`, /speechSynthesis|SpeechSynthesisUtterance|system-default/);
});

test('local voice requires a trusted main-frame origin and is cancelled across desktop lifecycle changes', () => {
  assert.match(main, /isTrustedRendererEvent/);
  assert.match(main, /isTrustedIpcEvent/);
  assert.match(main, /mainWindow\.isVisible\(\)/);
  assert.match(main, /did-start-navigation/);
  assert.match(main, /render-process-gone/);
  assert.match(main, /query-session-end/);
  assert.match(main, /localVoiceBridge\?\.cancelAll\(\)/);
  assert.match(main, /localVoiceBridge\?\.dispose\(\)/);
});

test('microphone is explicit-session-only and camera, screen, devices, downloads, and external requests fail closed', () => {
  assert.match(main, /Start hands-free talk\?/);
  assert.match(main, /defaultId: 1/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /permissionMayUseMicrophone/);
  assert.match(main, /setDisplayMediaRequestHandler\(\(_request, callback\) => callback\(\{\}\)/);
  assert.match(main, /setDevicePermissionHandler\(\(\) => false\)/);
  assert.match(main, /will-download/);
  assert.match(main, /externalRendererRequestsBlocked: true/);
  assert.match(main, /callback\(\{ cancel: !isSameAppOrigin/);
  assert.match(appSource, /requestHandsFreePermission\(\)/);
  assert.match(appSource, /armMicrophone\(\)/);
  assert.match(appSource, /disarmMicrophone\(\)/);
  assert.match(appSource, /async function toggleListening/);
});

test('custom icon is wired into the window, tray, and generated assets', () => {
  assert.match(main, /wellbeing-companion-icon\.png/);
  assert.match(main, /icon,/);
  assert.ok(fs.statSync(path.join(desktopRoot, 'assets', 'wellbeing-companion-icon.png')).size > 1_000);
  assert.ok(fs.statSync(path.join(desktopRoot, 'assets', 'WellbeingCompanionWorkingTitle.ico')).size > 1_000);
});

test('packaged smoke proves local runtime and records no live local-model invocation', () => {
  assert.match(main, /localStorageRoundTrip/);
  assert.match(main, /microphoneApprovedAtStartup/);
  assert.match(main, /displayCaptureAllowed: false/);
  assert.match(main, /liveProbePerformed: false/);
  assert.match(main, /providerConfigured: false/);
  assert.match(main, /playbackVerified: false/);
  assert.match(main, /systemVoiceFallback: false/);
  assert.match(main, /WELLBEING_COMPANION_DESKTOP_SMOKE_OK/);
});
