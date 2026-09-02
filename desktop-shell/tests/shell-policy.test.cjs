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
const packagedVoiceProbe = fs.readFileSync(path.join(desktopRoot, 'packaged-voice-probe.cjs'), 'utf8');
const localSpeech = fs.readFileSync(path.join(desktopRoot, 'local-speech.cjs'), 'utf8');
const packagedSpeechProbe = fs.readFileSync(path.join(desktopRoot, 'packaged-speech-probe.cjs'), 'utf8');
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
  assert.match(preload, /localSpeech/);
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
  assert.match(chatterboxVoice, /return postJsonImpl\(\{ port: ready\.port, authToken, route: '\/cancel'/);
  assert.match(packagedVoiceProbe, /fixedSyntheticProbeTextOnly: true/);
  assert.doesNotMatch(`${preload}\n${localVoice}\n${chatterboxVoice}\n${packagedVoiceProbe}`, /speechSynthesis|SpeechSynthesisUtterance|system-default/);
});

test('exact-package onboarding probe requires real playback while leaving microphone permission untouched', () => {
  assert.match(main, /onboardingVoiceProbeMode/);
  assert.match(main, /speechEnabledBeforeFinish/);
  assert.match(main, /actualPlaybackEventObserved: true/);
  assert.match(main, /playbackTimedEnergyObserved/);
  assert.match(main, /oldSpritePathMounted/);
  assert.match(main, /true3dAcceptance/);
  assert.match(main, /fullTurnUnclipped/);
  assert.match(main, /compactTurnUnclipped/);
  assert.match(main, /handsFreePermissionRequests: smokeHandsFreePermissionRequests/);
  assert.match(main, /microphoneOpened: false/);
  assert.match(main, /osPermissionBypassAttempted: false/);
  assert.match(main, /natural3dMotionClaimed: false/);
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

test('installed hands-free input uses only the bounded cache-only local speech IPC', () => {
  assert.match(preload, /status: \(\) => ipcRenderer\.invoke\('wellbeing:local-speech-status'\)/);
  assert.match(preload, /transcribe: \(request\) => ipcRenderer\.invoke\('wellbeing:local-speech-transcribe', request\)/);
  const speechBlock = preload.slice(preload.indexOf('localSpeech:'), preload.indexOf('setWindowMode:'));
  assert.doesNotMatch(speechBlock, /token|model|path|endpoint|providerId|fetch|https?/i);
  assert.match(main, /createLocalSpeechProvider/);
  assert.match(main, /LOCAL_SPEECH_MAX_AUDIO_BYTES/);
  assert.match(main, /isTrustedRendererEvent\(event\)/);
  assert.match(main, /Buffer\.from\(input\.buffer, input\.byteOffset, input\.byteLength\)/);
  assert.match(localSpeech, /host: '127\.0\.0\.1'/);
  assert.match(localSpeech, /HF_HUB_OFFLINE: '1'/);
  assert.match(localSpeech, /TRANSFORMERS_OFFLINE: '1'/);
  assert.match(localSpeech, /rawAudioPersisted: false/);
  assert.match(packagedSpeechProbe, /fixedSyntheticPackagedAudioOnly: true/);
  assert.match(appSource, /new MediaRecorder\(stream/);
  assert.match(appSource, /audioBitsPerSecond: 96_000/);
  assert.match(appSource, /localSpeech\.transcribe\(\{ requestId, mimeType, audio \}\)/);
  assert.match(appSource, /pause when you finish/);
  assert.match(appSource, /stream\.getTracks\(\)/);
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
  const smokeProbe = main.slice(
    main.indexOf('async function writeSmokeResultAndExit'),
    main.indexOf('let bundledRuntimeEvidence;'),
  );
  assert.match(main, /did-finish-load/);
  assert.match(main, /!smokeMode \|\| !isSameAppOrigin\(mainWindow\.webContents\.getURL\(\), BUNDLED_TARGET_URL\)/);
  assert.match(main, /resolveWindowPresentation\(smokeMode\)/);
  assert.match(main, /if \(smokeMode\) mainWindow\.setIgnoreMouseEvents\(true\)/);
  assert.match(main, /show: onboardingVoiceProbeMode \? true : smokeMode \|\| visualPreviewMode \? false : windowPresentation\.window\.show/);
  assert.match(main, /skipTaskbar: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode/);
  assert.match(main, /backgroundThrottling: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode \? false/);
  assert.match(main, /offscreen: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode/);
  assert.match(main, /if \(smokeMode && typeof mainWindow\.webContents\.setFrameRate === 'function'\)[\s\S]*mainWindow\.webContents\.setFrameRate\(30\)/);
  assert.match(main, /localStorageRoundTrip/);
  assert.match(main, /microphoneApprovedAtStartup/);
  assert.match(main, /displayCaptureAllowed: false/);
  assert.match(main, /liveProbePerformed: false/);
  assert.match(main, /providerConfigured: false/);
  assert.match(main, /playbackVerified: false/);
  assert.match(main, /systemVoiceFallback: false/);
  assert.match(main, /\.reactive-companion-orb/);
  assert.match(main, /renderer === 'reactive-css-orb-2d'/);
  assert.match(main, /temporary-orb-not-3d-character/);
  assert.match(main, /fail-temporary-orb-no-live-mesh/);
  assert.match(main, /oldSpritePathMounted/);
  assert.match(main, /speechTiming/);
  assert.match(main, /voiceReactiveCore/);
  assert.match(smokeProbe, /else setTimeout\(inspect, 25\)/);
  assert.match(smokeProbe, /await new Promise\(\(resolve\) => setTimeout\(resolve, 25\)\)/);
  assert.match(smokeProbe, /await new Promise\(\(resolve\) => setTimeout\(resolve, 50\)\)/);
  assert.doesNotMatch(smokeProbe, /requestAnimationFrame/);
  assert.match(smokeProbe, /probeTimedOut: true \}\), 20_000/);
  assert.match(main, /motionTick >= 15/);
  assert.match(main, /runtimeObserved/);
  assert.match(main, /stableCenter/);
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
  assert.match(main, /show: onboardingVoiceProbeMode \? true : smokeMode \|\| visualPreviewMode \? false : windowPresentation\.window\.show/);
  assert.match(main, /opacity: onboardingVoiceProbeMode \? 0 : windowPresentation\.window\.opacity/);
  assert.match(main, /skipTaskbar: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode/);
  assert.match(main, /backgroundThrottling: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode \? false/);
  assert.match(main, /offscreen: smokeMode \|\| visualPreviewMode \|\| onboardingVoiceProbeMode/);
  assert.match(main, /status: 'owner-visual-review-required'/);
  assert.match(main, /packagePromoted: false/);
  assert.match(main, /onboardingCaptured: onboardingPresent/);
  assert.match(main, /initialRendererTarget\.searchParams\.set\('desktop', '1'\)/);
  assert.match(main, /Reload local app'[\s\S]*mainWindow\?\.reload\(\)/);
  assert.match(main, /isolatedUserData: 'temporary isolated preview profile \(not included\)'/);

  for (const requiredCapture of [
    '00a-onboarding-name.png',
    '00b-onboarding-voice.png',
    '00c-onboarding-theme.png',
    '00d-onboarding-microphone.png',
    '01-full-home-dark.png',
    '02-full-home-light.png',
    '03-compact-orb-chat.png',
    '04-compact-controls-revealed.png',
    '05-orb-only.png',
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
