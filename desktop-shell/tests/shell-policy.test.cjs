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
const chatterboxVoice = fs.readFileSync(path.join(desktopRoot, 'chatterbox-local-voice.cjs'), 'utf8');
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

test('renderer uses the bounded Windows compatibility state and the preload surface is narrow', () => {
  assert.match(main, /sandbox: !gpuSandboxCompatibility\.disableRendererSandbox/);
  assert.match(main, /if \(!gpuSandboxCompatibility\.disableRendererSandbox\) app\.enableSandbox\(\)/);
  assert.match(main, /if \(smokeMode\) app\.disableHardwareAcceleration\(\)/);
  assert.doesNotMatch(main, /appendSwitch\('no-sandbox'\)/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /webviewTag: false/);
  assert.match(main, /preload: path\.join\(__dirname, 'preload\.cjs'\)/);
  assert.match(preload, /requestHandsFreePermission/);
  assert.match(preload, /armMicrophone/);
  assert.match(preload, /disarmMicrophone/);
  assert.match(preload, /localVoice/);
  assert.match(preload, /localModel/);
  assert.match(preload, /setWindowMode: \(mode\) => ipcRenderer\.invoke\('wellbeing:set-window-mode', mode\)/);
  assert.match(preload, /setAlwaysOnTop: \(enabled\) => ipcRenderer\.invoke\('wellbeing:set-always-on-top', enabled\)/);
  assert.match(preload, /hideWindow: \(\) => ipcRenderer\.send\('wellbeing:hide-window'\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|invoke)\([^'"`]/);
});

test('compact and character-only native controls validate trusted renderer input', () => {
  assert.match(main, /setNativeWindowMode/);
  assert.match(main, /assertWindowMode\(mode\)/);
  assert.match(main, /screen\.getDisplayMatching\(mainWindow\.getBounds\(\)\)/);
  assert.match(main, /ipcMain\.handle\('wellbeing:set-window-mode'/);
  assert.match(main, /ipcMain\.handle\('wellbeing:set-always-on-top'/);
  assert.match(main, /ipcMain\.on\('wellbeing:hide-window'/);
  assert.match(main, /if \(!isTrustedRenderer\(event\.sender\)\)/);
  assert.match(main, /mainWindow\.setAlwaysOnTop\(enabled, 'floating'\)/);
  assert.match(main, /mode !== WINDOW_MODE\.FULL && currentWindowMode === WINDOW_MODE\.FULL/);
});

test('local voice exposes only fixed status, speak, and cancel IPC and no renderer provider internals', () => {
  assert.match(preload, /status: \(\) => ipcRenderer\.invoke\('wellbeing:local-voice-status'\)/);
  assert.match(preload, /speak: \(request\) => ipcRenderer\.invoke\('wellbeing:local-voice-speak', request\)/);
  assert.match(preload, /cancel: \(requestId\) => ipcRenderer\.invoke\('wellbeing:local-voice-cancel', requestId\)/);
  const preloadVoiceBlock = preload.slice(preload.indexOf('localVoice:'), preload.indexOf('localModel:'));
  assert.doesNotMatch(preloadVoiceBlock, /token|model|path|endpoint|providerId|speechSynthesis|SpeechSynthesisUtterance/i);
  assert.match(main, /registerLocalVoiceIpc/);
  assert.match(main, /smokeMode \|\| visualPreviewMode[\s\S]*createUnavailableLocalVoiceProvider/);
  assert.match(main, /createChatterboxLocalVoiceProvider/);
  assert.match(main, /approvedProviderId: smokeMode \|\| visualPreviewMode \? null : CHATTERBOX_PROVIDER_ID/);
  assert.match(localVoice, /createUnavailableLocalVoiceProvider/);
  assert.match(chatterboxVoice, /host: '127\.0\.0\.1'/);
  assert.match(chatterboxVoice, /Authorization: `Bearer \$\{authToken\}`/);
  assert.match(chatterboxVoice, /shell: false/);
  assert.match(chatterboxVoice, /HF_HUB_OFFLINE: '1'/);
  assert.match(chatterboxVoice, /TRANSFORMERS_OFFLINE: '1'/);
  assert.doesNotMatch(`${preload}\n${localVoice}\n${chatterboxVoice}`, /speechSynthesis|SpeechSynthesisUtterance|system-default/);
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
  assert.match(main, /did-finish-load/);
  assert.match(main, /!smokeMode \|\| !isSameAppOrigin\(mainWindow\.webContents\.getURL\(\), BUNDLED_TARGET_URL\)/);
  assert.match(main, /resolveWindowPresentation\(smokeMode\)/);
  assert.match(main, /if \(smokeMode\) mainWindow\.setIgnoreMouseEvents\(true\)/);
  assert.match(main, /localStorageRoundTrip/);
  assert.match(main, /microphoneApprovedAtStartup/);
  assert.match(main, /displayCaptureAllowed: false/);
  assert.match(main, /liveProbePerformed: false/);
  assert.match(main, /providerConfigured: false/);
  assert.match(main, /playbackVerified: false/);
  assert.match(main, /systemVoiceFallback: false/);
  assert.match(main, /canvas\.mascot-canvas/);
  assert.match(main, /renderer === 'webgl-3d-motion'/);
  assert.match(main, /motionTick >= 15/);
  assert.match(main, /movementObserved/);
  assert.match(main, /waving/);
  assert.match(main, /denied-by-packaged-smoke-policy/);
  assert.match(main, /Microphone permission was not granted\. Text conversation remains available\./);
  assert.match(main, /Please do not diagnose me\./);
  assert.match(main, /Deterministic safety response/);
  assert.match(main, /deterministicReplyObserved/);
  assert.match(main, /handsFreePermissionRequestsDuringSmoke/);
  assert.match(main, /smokeHandsFreeDecision/);
  assert.match(main, /textareaClearedAfterReply/);
  assert.match(main, /composerUsableAfterReply/);
  assert.match(main, /microphoneApprovedAfterDeniedInteraction/);
  assert.match(main, /microphoneArmedAfterDeniedInteraction/);
  assert.match(main, /brandIconEvidence/);
  assert.match(main, /nativeWindowTitle/);
  assert.match(main, /page-title-updated/);
  assert.match(main, /mainWindow\.setTitle\(APP_NAME\)/);
  assert.match(main, /WELLBEING_COMPANION_DESKTOP_SMOKE_OK/);
});

test('owner visual previews stay hidden, isolated, portable, and approval-gated', () => {
  assert.match(main, /const visualPreviewMode = Boolean\(visualPreviewDirectory\)/);
  assert.match(main, /show: visualPreviewMode \? false : windowPresentation\.window\.show/);
  assert.match(main, /backgroundThrottling: visualPreviewMode \? false/);
  assert.match(main, /offscreen: visualPreviewMode/);
  assert.match(main, /status: 'owner-visual-review-required'/);
  assert.match(main, /packagePromoted: false/);
  assert.match(main, /isolatedUserData: 'temporary isolated preview profile \(not included\)'/);

  for (const requiredCapture of [
    '01-full-home-dark.png',
    '02-full-home-light.png',
    '03-compact-character-chat.png',
    '04-compact-controls-revealed.png',
    '05-character-only.png',
    '06-settings-and-privacy.png',
    '07-activities-and-emotion.png',
    '08-urgent-support-keeps-talking.png',
  ]) {
    assert.ok(main.includes(requiredCapture), `missing required visual capture: ${requiredCapture}`);
  }
  assert.match(main, /button\[aria-label="Show quick settings"\]/);
  assert.match(main, /setNativeWindowMode\(WINDOW_MODE\.FULL\)/);
  assert.match(main, /button\[aria-label="Open settings"\]/);
  assert.match(main, /document\.querySelector\('aside\.drawer\.open\[aria-label="Settings"\]'\)/);

  const previewCaptureSource = main.slice(
    main.indexOf('async function runVisualPreviewCapture'),
    main.indexOf('async function writeVisualPreviewFailureAndExit'),
  );
  assert.doesNotMatch(previewCaptureSource, /app\.getPath\('userData'\)|[A-Za-z]:\\\\|Users\\\\/);
});
