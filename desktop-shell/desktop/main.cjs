'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  screen,
  session,
  shell,
  Tray,
} = require('electron');
const {
  CloseAction,
  closeDialogResponseToAction,
  quitDialogResponseIsConfirmed,
  resolveWindowPresentation,
} = require('./lifecycle.cjs');
const {
  isAudioOnlyCheck,
  isAudioOnlyPermission,
  isSameAppOrigin,
  isTrustedIpcEvent,
  permissionMayUseMicrophone,
} = require('./permissions.cjs');
const {
  ALLOWLISTED_MODELS,
  DEFAULT_MODEL,
  OLLAMA_ORIGIN,
  createLocalModelBridge,
} = require('./local-model.cjs');
const {
  createLocalVoiceBridge,
  createUnavailableLocalVoiceProvider,
  registerLocalVoiceIpc,
} = require('./local-voice.cjs');
const {
  PROVIDER_ID: CHATTERBOX_PROVIDER_ID,
  createChatterboxLocalVoiceProvider,
} = require('./chatterbox-local-voice.cjs');
const {
  BUNDLED_TARGET_URL,
  HEALTH_PATH,
  startBundledRuntime,
  stopBundledRuntime,
} = require('./runtime.cjs');
const { resolveGpuSandboxCompatibility } = require('./gpu-sandbox-compatibility.cjs');
const { loadInitialTargetWithRetry, waitFor } = require('./startup-retry.cjs');
const {
  WINDOW_MODE,
  applyWindowMode,
  assertWindowMode,
  defaultAlwaysOnTopForMode,
} = require('./window-mode.cjs');

const APP_NAME = 'Wellbeing Companion — Working Title';
const APP_FOLDER = 'WellbeingCompanionWorkingTitle';
const APP_USER_MODEL_ID = 'com.kiralabs.wellbeing-companion-working-title';
const PARTITION = 'persist:wellbeing-companion-working-title';
const MICROPHONE_ARM_MS = 20_000;
const smokeMode = process.argv.includes('--smoke-test');
const visualPreviewDirectory = findArgument('--visual-preview-dir');
const visualPreviewMode = Boolean(visualPreviewDirectory);
const initialWindowMode = smokeMode || visualPreviewMode ? WINDOW_MODE.FULL : WINDOW_MODE.COMPACT;
const gpuSandboxCompatibility = resolveGpuSandboxCompatibility({
  platform: process.platform,
  release: os.release(),
  argv: process.argv,
  env: process.env,
});
const CONFIGURED_SECURITY = Object.freeze({
  sandbox: !gpuSandboxCompatibility.disableRendererSandbox,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  navigateOnDragDrop: false,
});

let mainWindow;
let tray;
let bundledRuntime;
let quitApproved = false;
let sessionEnding = false;
let closePromptOpen = false;
let hiddenNoticeShown = false;
let smokeReceiptStarted = false;
let microphoneApprovedForSession = false;
let microphoneArmedUntil = 0;
let microphonePromptPromise;
let initialNavigationEvidence;
let sessionPolicyEvidence;
let localModelBridge;
let localVoiceBridge;
let brandIconEvidence;
let smokeHandsFreePermissionRequests = 0;
let runtimeWarmupEvidence;
let currentWindowMode = initialWindowMode;
let lastFullBounds = { width: 1440, height: 940 };

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
if (gpuSandboxCompatibility.disableGpuSandbox) app.commandLine.appendSwitch('disable-gpu-sandbox');
if (!gpuSandboxCompatibility.disableRendererSandbox) app.enableSandbox();
if (smokeMode) app.disableHardwareAcceleration();

if (smokeMode) {
  const smokeUserData = process.env.COMPANION_SMOKE_USER_DATA;
  if (!smokeUserData) throw new Error('COMPANION_SMOKE_USER_DATA is required in smoke mode.');
  fs.mkdirSync(path.resolve(smokeUserData), { recursive: true });
  app.setPath('userData', path.resolve(smokeUserData));
} else if (visualPreviewMode) {
  const previewRoot = path.resolve(visualPreviewDirectory);
  fs.mkdirSync(previewRoot, { recursive: true });
  const previewUserDataTag = crypto.createHash('sha256').update(previewRoot).digest('hex').slice(0, 12);
  const previewUserData = path.join(os.tmpdir(), 'WellbeingCompanionVisualPreview', previewUserDataTag);
  fs.mkdirSync(previewUserData, { recursive: true });
  app.setPath('userData', previewUserData);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), APP_FOLDER, 'UserData'));
}

function findArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return argument?.slice(prefix.length + 1);
}

function createOwnerMarker() {
  if (smokeMode || visualPreviewMode) return;
  const dataRoot = path.dirname(app.getPath('userData'));
  fs.mkdirSync(dataRoot, { recursive: true });
  const marker = path.join(dataRoot, '.wellbeing-companion-owner.json');
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(marker, `${JSON.stringify({
      schema: 1,
      productId: APP_USER_MODEL_ID,
      root: dataRoot,
      dataPolicy: 'Preserve by default; explicit remove-all only',
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
}

function createBrandIcon() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'wellbeing-companion-icon.png'));
  if (!icon.isEmpty()) return icon;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="16" fill="#392043"/><circle cx="32" cy="32" r="20" fill="#f6d4e8"/><path d="M32 17l4 10 11 1-9 7 3 11-9-6-9 6 3-11-9-7 11-1z" fill="#9a4b88"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  localVoiceBridge?.cancelAll();
  mainWindow.hide();
  disarmMicrophone();
  if (!hiddenNoticeShown && tray && process.platform === 'win32') {
    hiddenNoticeShown = true;
    tray.displayBalloon({
      title: 'Your companion is still available',
      content: 'Use the notification-area icon to reopen or quit.',
      noSound: true,
    });
  }
}

function setNativeWindowMode(mode) {
  assertWindowMode(mode);
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The companion window is not available.');
  if (mode !== WINDOW_MODE.FULL && currentWindowMode === WINDOW_MODE.FULL) lastFullBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  const result = applyWindowMode(mainWindow, mode, display.workArea, lastFullBounds);
  setNativeAlwaysOnTop(defaultAlwaysOnTopForMode(mode));
  currentWindowMode = mode;
  if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('wellbeing:window-mode-changed', mode);
  return {
    ...result,
    alwaysOnTop: mainWindow.isAlwaysOnTop(),
  };
}

function setNativeAlwaysOnTop(enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('Always-on-top must be a boolean.');
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setAlwaysOnTop(enabled, 'floating');
  return mainWindow.isAlwaysOnTop();
}

async function confirmRealExit() {
  if (closePromptOpen) return false;
  closePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Quit the wellbeing companion?',
      message: 'Quit the companion completely?',
      detail: 'The private local window and notification-area helper will close. Ordinary browser windows are independent.',
      buttons: ['Quit companion', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (!quitDialogResponseIsConfirmed(result.response)) return false;
    quitApproved = true;
    app.quit();
    return true;
  } finally {
    closePromptOpen = false;
  }
}

async function handleWindowCloseRequest() {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Keep your companion available?',
      message: 'What should the companion do?',
      detail: 'Keep running hides the app in the notification area. Only Quit fully exits it.',
      buttons: ['Keep running', 'Quit companion', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    const action = closeDialogResponseToAction(result.response);
    if (action === CloseAction.HIDE) hideToTray();
    if (action === CloseAction.QUIT) {
      quitApproved = true;
      app.quit();
    }
  } finally {
    closePromptOpen = false;
  }
}

function isSafeExternalUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    return !parsed.username && !parsed.password && ['https:', 'mailto:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function askBeforeOpeningExternal(candidate) {
  if (!isSafeExternalUrl(candidate) || !mainWindow) return;
  const parsed = new URL(candidate);
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Open outside the companion?',
    message: `Open ${parsed.hostname || parsed.protocol} in your default app?`,
    detail: 'The private companion stays local. This link opens outside it and may use the internet.',
    buttons: ['Open', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (result.response === 0) await shell.openExternal(candidate);
}

function isTrustedRenderer(sender) {
  return Boolean(mainWindow
    && !mainWindow.isDestroyed()
    && sender === mainWindow.webContents
    && isSameAppOrigin(sender.getURL(), BUNDLED_TARGET_URL));
}

function isTrustedRendererEvent(event) {
  try {
    return Boolean(mainWindow && !mainWindow.isDestroyed() && isTrustedIpcEvent({
      event,
      expectedWebContents: mainWindow.webContents,
      targetUrl: BUNDLED_TARGET_URL,
      lifecycleActive: !quitApproved && !sessionEnding && mainWindow.isVisible(),
    }));
  } catch {
    return false;
  }
}

function disarmMicrophone() {
  microphoneArmedUntil = 0;
}

async function promptForHandsFree(sender) {
  if (!isTrustedRenderer(sender)) return false;
  // The packaged-process smoke exercises the real renderer's denial recovery
  // without opening an unattended native permission prompt or arming hardware.
  if (smokeMode) {
    smokeHandsFreePermissionRequests += 1;
    return false;
  }
  if (microphoneApprovedForSession) {
    microphoneArmedUntil = Date.now() + MICROPHONE_ARM_MS;
    return true;
  }
  if (microphonePromptPromise) return microphonePromptPromise;
  microphonePromptPromise = dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: 'Start hands-free talk?',
    message: 'Allow microphone audio for this app session?',
    detail: 'This request appears only because you started hands-free talk. Camera and screen capture stay blocked. Stop hands-free talk at any time to disarm the microphone.',
    buttons: ['Allow microphone', 'Not now'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }).then((result) => {
    microphoneApprovedForSession = result.response === 0;
    microphoneArmedUntil = microphoneApprovedForSession ? Date.now() + MICROPHONE_ARM_MS : 0;
    return microphoneApprovedForSession;
  }).finally(() => {
    microphonePromptPromise = undefined;
  });
  return microphonePromptPromise;
}

async function configureSecurityControls() {
  const desktopSession = session.fromPartition(PARTITION);
  await desktopSession.setProxy({ mode: 'direct' });
  sessionPolicyEvidence = Object.freeze({
    mode: 'direct',
    fixedOrigin: BUNDLED_TARGET_URL,
    externalRendererRequestsBlocked: true,
  });
  desktopSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: !isSameAppOrigin(details.url, BUNDLED_TARGET_URL) });
  });
  desktopSession.on('will-download', (event) => event.preventDefault());
  desktopSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed = permissionMayUseMicrophone({
      approved: microphoneApprovedForSession,
      armedUntil: microphoneArmedUntil,
    }) && isAudioOnlyPermission(permission, details.requestingUrl, BUNDLED_TARGET_URL, details.mediaTypes);
    callback(allowed);
  });
  desktopSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    return permissionMayUseMicrophone({
      approved: microphoneApprovedForSession,
      armedUntil: microphoneArmedUntil,
    }) && isAudioOnlyCheck(permission, requestingOrigin, BUNDLED_TARGET_URL, details.mediaType);
  });
  desktopSession.setDevicePermissionHandler(() => false);
  desktopSession.setDisplayMediaRequestHandler((_request, callback) => callback({}), {
    useSystemPicker: false,
  });
}

function registerIpc() {
  ipcMain.handle('wellbeing:request-hands-free', async (event) => promptForHandsFree(event.sender));
  ipcMain.handle('wellbeing:arm-microphone', (event) => {
    if (!isTrustedRenderer(event.sender) || !microphoneApprovedForSession) return false;
    microphoneArmedUntil = Date.now() + MICROPHONE_ARM_MS;
    return true;
  });
  ipcMain.on('wellbeing:disarm-microphone', (event) => {
    if (isTrustedRenderer(event.sender)) disarmMicrophone();
  });
  ipcMain.handle('wellbeing:set-window-mode', (event, mode) => {
    if (!isTrustedRenderer(event.sender)) return { mode: WINDOW_MODE.FULL, alwaysOnTop: false, rejected: true };
    return setNativeWindowMode(mode);
  });
  ipcMain.handle('wellbeing:set-always-on-top', (event, enabled) => {
    if (!isTrustedRenderer(event.sender)) return false;
    return setNativeAlwaysOnTop(enabled);
  });
  ipcMain.on('wellbeing:hide-window', (event) => {
    if (isTrustedRenderer(event.sender)) hideToTray();
  });
  ipcMain.handle('wellbeing:local-model-status', (event) => {
    if (!isTrustedRenderer(event.sender)) {
      return {
        available: false,
        endpoint: OLLAMA_ORIGIN,
        installedAllowlistedModels: [],
        defaultModel: DEFAULT_MODEL,
        externalNetwork: false,
        fallbackCode: 'untrusted-renderer',
      };
    }
    return localModelBridge.status();
  });
  ipcMain.handle('wellbeing:local-model-enhance-steady', (event, request) => {
    if (!isTrustedRenderer(event.sender)) {
      return {
        status: 'fallback',
        candidateText: null,
        fallback: { code: 'untrusted-renderer', deterministicReplyRequired: true },
        provenance: {
          runtime: 'ollama-loopback',
          endpoint: OLLAMA_ORIGIN,
          model: DEFAULT_MODEL,
          externalNetwork: false,
          deterministicGate: 'steady-only',
          durationMs: 0,
        },
      };
    }
    return localModelBridge.enhanceSteadyReply(request);
  });
  registerLocalVoiceIpc({
    ipcMain,
    bridge: localVoiceBridge,
    isTrustedEvent: isTrustedRendererEvent,
  });
}

function createMenus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Companion',
      submenu: [
        { label: 'Show companion', click: showWindow },
        { label: 'Hide to notification area', click: hideToTray },
        { label: 'Compact work-beside-me mode', click: () => setNativeWindowMode(WINDOW_MODE.COMPACT) },
        { label: 'Character-only corner mode', click: () => setNativeWindowMode(WINDOW_MODE.CHARACTER) },
        { label: 'Restore full companion', click: () => setNativeWindowMode(WINDOW_MODE.FULL) },
        { type: 'separator' },
        { label: 'Reload local app', accelerator: 'Ctrl+R', click: () => mainWindow?.loadURL(BUNDLED_TARGET_URL) },
        { type: 'separator' },
        { label: 'Quit companion…', accelerator: 'Ctrl+Q', click: confirmRealExit },
      ],
    },
    { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
}

function createTray(icon) {
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip('Wellbeing companion — working title');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show companion', click: showWindow },
    { label: 'Hide companion', click: hideToTray },
    { type: 'separator' },
    { label: 'Quit companion…', click: confirmRealExit },
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
}

async function probeRuntime() {
  const response = await net.fetch(new URL(HEALTH_PATH, BUNDLED_TARGET_URL));
  const report = await response.json();
  return {
    status: response.status,
    ok: report?.ok === true,
    service: report?.service ?? null,
    workingTitle: report?.workingTitle === true,
    offlineReady: report?.offlineReady === true,
    externalModelConfigured: report?.externalModelConfigured === true,
  };
}

async function warmRendererSessionRuntime() {
  const desktopSession = session.fromPartition(PARTITION);
  const response = await desktopSession.fetch(new URL(HEALTH_PATH, BUNDLED_TARGET_URL));
  const report = await response.json();
  if (response.status !== 200 || report?.ok !== true || report?.service !== 'wellbeing-companion-local') {
    throw new Error('The renderer session could not verify the private local companion runtime before navigation.');
  }
  return Object.freeze({
    status: response.status,
    ok: true,
    service: report.service,
    exactRendererSession: true,
  });
}

function getGpuSandboxCompatibilityEvidence() {
  return {
    ...gpuSandboxCompatibility,
    disableGpuSandboxSwitchPresent: app.commandLine.hasSwitch('disable-gpu-sandbox'),
  };
}

async function writeSmokeResultAndExit() {
  if (smokeReceiptStarted) return;
  smokeReceiptStarted = true;
  const resultPath = findArgument('--smoke-result') ?? process.env.COMPANION_SMOKE_RESULT;
  let rendererProbe;
  try {
    rendererProbe = await Promise.race([
      mainWindow.webContents.executeJavaScript(`(async () => {
         const key = '__wellbeing_companion_isolated_smoke__';
         localStorage.setItem(key, 'round-trip-ok');
         const value = localStorage.getItem(key);
         localStorage.removeItem(key);
         const canvas = document.querySelector('canvas.mascot-canvas');
         if (canvas) {
           const deadline = performance.now() + 1_400;
           await new Promise((resolve) => {
             const inspect = () => {
               const tick = Number.parseInt(canvas.dataset.motionTick ?? '0', 10);
               if (tick >= 15 || performance.now() >= deadline) resolve();
               else requestAnimationFrame(inspect);
             };
             inspect();
           });
         }
         const renderer = canvas?.dataset.renderer ?? null;
         const motionTick = Number.parseInt(canvas?.dataset.motionTick ?? '0', 10);
         const motionState = canvas?.dataset.motionState ?? null;
         const waving = typeof motionState === 'string' && motionState.split(':')[2] === 'true';
         const waitForCondition = async (predicate, timeoutMs) => {
           const deadline = performance.now() + timeoutMs;
           while (performance.now() < deadline) {
             if (predicate()) return true;
             await new Promise((resolve) => requestAnimationFrame(resolve));
           }
           return Boolean(predicate());
         };
         const micButton = document.querySelector('button[aria-label="Start hands-free conversation"]');
         const textarea = document.querySelector('textarea#message');
         const composer = document.querySelector('form.composer');
         const turnsBefore = document.querySelectorAll('.turn').length;
         micButton?.click();
         const denialObserved = await waitForCondition(() => {
           const status = document.querySelector('.voice-status')?.textContent ?? '';
           return status.includes('Microphone permission was not granted. Text conversation remains available.');
         }, 1_200);
         const statusAfterDenial = document.querySelector('.voice-status')?.textContent?.trim() ?? null;
         const textareaEnabledAfterDenial = Boolean(textarea && !textarea.disabled);
         const sendEnabledAfterDenial = Boolean(document.querySelector('button[aria-label="Send message"]:not([disabled])'));
         const micReturnedOff = micButton?.getAttribute('aria-pressed') === 'false';
         const typedPrompt = 'Please do not diagnose me.';
         const expectedReply = "I won't label or diagnose you from a conversation. I can help you describe what you have noticed—when it started, what makes it better or worse, sleep, energy, and how it affects daily life—so you have a clearer record for a qualified clinician if you choose to speak with one.";
         const valueSetter = textarea
           ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
           : null;
         if (textarea && valueSetter) {
           valueSetter.call(textarea, typedPrompt);
           textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: typedPrompt }));
           await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
           if (typeof composer?.requestSubmit === 'function') composer.requestSubmit();
           else composer?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
         }
         const deterministicReplyObserved = await waitForCondition(() => {
           const userTurns = Array.from(document.querySelectorAll('.turn.user p'));
           const companionTurns = Array.from(document.querySelectorAll('.turn.companion p'));
           return userTurns.some((turn) => turn.textContent?.trim() === typedPrompt)
             && companionTurns.at(-1)?.textContent?.trim() === expectedReply
             && document.querySelectorAll('.turn').length === turnsBefore + 2
             && document.querySelector('.model-receipt')?.textContent?.includes('Deterministic safety response');
         }, 2_000);
         const userTurnObserved = Array.from(document.querySelectorAll('.turn.user p'))
           .some((turn) => turn.textContent?.trim() === typedPrompt);
         const companionTurns = Array.from(document.querySelectorAll('.turn.companion p'));
         const replyText = companionTurns.at(-1)?.textContent?.trim() ?? null;
         const sendButton = document.querySelector('button[aria-label="Send message"]');
         const modelReceipt = document.querySelector('.model-receipt')?.textContent?.trim() ?? null;
         const textareaClearedAfterReply = textarea?.value === '';
         const composerUsableAfterReply = Boolean(textarea && !textarea.disabled && sendButton && !sendButton.disabled);
         const completed = denialObserved
           && micReturnedOff
           && textareaEnabledAfterDenial
           && sendEnabledAfterDenial
           && userTurnObserved
           && deterministicReplyObserved
           && replyText === expectedReply
           && Boolean(modelReceipt?.includes('Deterministic safety response'))
           && textareaClearedAfterReply
           && composerUsableAfterReply;
         return {
          locationProtocol: location.protocol,
          requireType: typeof require,
          processType: typeof process,
          documentReadyState: document.readyState,
          documentTitle: document.title,
          workingTitlePresent: document.body.innerText.includes('WORKING TITLE'),
           localStorageRoundTrip: value,
           companion3d: {
             canvasPresent: Boolean(canvas),
             renderer,
             model: canvas?.dataset.model ?? null,
             depthTest: canvas?.dataset.depthTest ?? null,
             hierarchy: canvas?.dataset.hierarchy ?? null,
             rendererLifecycle: canvas?.dataset.rendererLifecycle ?? null,
             motionTick,
             motionState,
             waving,
             movementObserved: renderer === 'webgl-3d-motion' && motionTick >= 15 && waving
           },
           handsFreeTextRecovery: {
             bounded: true,
             permissionDecision: 'denied-by-packaged-smoke-policy',
             denialObserved,
             statusAfterDenial,
             micReturnedOff,
             textareaEnabledAfterDenial,
             sendEnabledAfterDenial,
             typedPrompt,
             expectedReply,
             userTurnObserved,
             deterministicReplyObserved,
             replyText,
             modelReceipt,
             textareaClearedAfterReply,
             composerUsableAfterReply,
             completed
           }
         };
      })()`),
      new Promise((resolve) => setTimeout(() => resolve({ probeTimedOut: true }), 8_000)),
    ]);
  } catch (error) {
    rendererProbe = { probeError: error instanceof Error ? error.message : String(error) };
  }
  let bundledRuntimeEvidence;
  try {
    bundledRuntimeEvidence = await probeRuntime();
  } catch (error) {
    bundledRuntimeEvidence = { ok: false, errorName: error instanceof Error ? error.name : 'UnknownError' };
  }
  const rendererUrl = mainWindow.webContents.getURL();
  const result = {
    status: 'ok',
    app: APP_NAME,
    appUserModelId: APP_USER_MODEL_ID,
    electronProcess: true,
    windowCreated: !mainWindow.isDestroyed(),
    trayCreated: Boolean(tray && !tray.isDestroyed()),
    rendererLoaded: isSameAppOrigin(rendererUrl, BUNDLED_TARGET_URL),
    rendererUrl,
    nativeWindowTitle: mainWindow.getTitle(),
    brandIconEvidence,
    rendererProbe,
    bundledRuntimeStarted: Boolean(bundledRuntime?.server?.listening),
    bundledRuntimeEvidence,
    configuredSecurity: { ...CONFIGURED_SECURITY },
    permissionBoundary: {
      microphoneRequiresExplicitHandsFreeIpc: true,
      microphoneApprovedAtStartup: microphoneApprovedForSession,
      microphoneArmedAtStartup: permissionMayUseMicrophone({ approved: microphoneApprovedForSession, armedUntil: microphoneArmedUntil }),
      microphoneApprovedAfterDeniedInteraction: microphoneApprovedForSession,
      microphoneArmedAfterDeniedInteraction: permissionMayUseMicrophone({ approved: microphoneApprovedForSession, armedUntil: microphoneArmedUntil }),
      handsFreePermissionRequestsDuringSmoke: smokeHandsFreePermissionRequests,
      smokeHandsFreeDecision: 'denied',
      cameraAllowed: false,
      displayCaptureAllowed: false,
      devicePermissionsAllowed: false,
    },
    localModelBoundary: {
      endpoint: OLLAMA_ORIGIN,
      allowlistedModels: [...ALLOWLISTED_MODELS],
      defaultModel: DEFAULT_MODEL,
      steadyOnly: true,
      externalNetwork: false,
      liveProbePerformed: false,
    },
    localVoiceBoundary: {
      ipcMethods: ['status', 'speak', 'cancel'],
      providerConfigured: false,
      providerReady: false,
      playbackVerified: false,
      systemVoiceFallback: false,
      liveProbePerformed: false,
    },
    sessionPolicy: sessionPolicyEvidence,
    initialNavigationEvidence,
    runtimeWarmupEvidence,
    gpuSandboxCompatibility: getGpuSandboxCompatibilityEvidence(),
    isolatedUserData: app.getPath('userData'),
  };
  if (resultPath) fs.writeFileSync(path.resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`WELLBEING_COMPANION_DESKTOP_SMOKE_OK ${JSON.stringify(result)}\n`);
  quitApproved = true;
  localVoiceBridge?.cancelAll();
  mainWindow.destroy();
  await stopBundledRuntime(bundledRuntime);
  app.exit(0);
}

async function writeSmokeFailureAndExit(error) {
  const resultPath = findArgument('--smoke-result') ?? process.env.COMPANION_SMOKE_RESULT;
  const result = {
    status: 'error',
    app: APP_NAME,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : String(error),
    bundledRuntimeStarted: Boolean(bundledRuntime?.server?.listening),
    runtimeWarmupEvidence: runtimeWarmupEvidence ?? null,
    initialNavigationEvidence: error?.navigationRetryEvidence ?? initialNavigationEvidence ?? null,
    gpuSandboxCompatibility: getGpuSandboxCompatibilityEvidence(),
  };
  if (resultPath) fs.writeFileSync(path.resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stderr.write(`WELLBEING_COMPANION_DESKTOP_SMOKE_ERROR ${JSON.stringify(result)}\n`);
  quitApproved = true;
  await stopBundledRuntime(bundledRuntime);
  app.exit(1);
}

function waitForPreview(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVisualPreviewCapture() {
  const previewRoot = path.resolve(visualPreviewDirectory);
  const captures = [];
  const evaluate = (source) => mainWindow.webContents.executeJavaScript(source, true);
  const capture = async (fileName, label) => {
    await waitForPreview(500);
    mainWindow.webContents.invalidate();
    await waitForPreview(120);
    // Hidden/offscreen Chromium can retain one compositor frame. Prime once,
    // then invalidate again so each evidence file reflects its asserted state.
    await mainWindow.webContents.capturePage();
    mainWindow.webContents.invalidate();
    await waitForPreview(120);
    const image = await mainWindow.webContents.capturePage();
    if (image.isEmpty()) throw new Error(`Visual preview capture was empty: ${fileName}`);
    const outputPath = path.join(previewRoot, fileName);
    const bytes = image.toPNG();
    fs.writeFileSync(outputPath, bytes);
    captures.push({
      file: fileName,
      label,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
      size: image.getSize(),
    });
  };
  const setPreviewTheme = async (label, expectedTheme) => {
    await evaluate(`document.querySelector('button[aria-label="Open settings"]')?.click()`);
    await waitForPreview(180);
    const actualTheme = await evaluate(`(async () => {
      const label = Array.from(document.querySelectorAll('.theme-choices label')).find((candidate) => candidate.querySelector('strong')?.textContent?.trim() === ${JSON.stringify(label)});
      label?.querySelector('input')?.click();
      const deadline = performance.now() + 1200;
      while (document.documentElement.dataset.theme !== ${JSON.stringify(expectedTheme)} && performance.now() < deadline) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return document.documentElement.dataset.theme ?? null;
    })()`);
    if (actualTheme !== expectedTheme) throw new Error(`Preview theme did not settle to ${expectedTheme}; received ${actualTheme}.`);
    await evaluate(`document.querySelector('button[aria-label="Close settings"]')?.click()`);
    await waitForPreview(180);
  };

  await evaluate(`(async () => {
    await document.fonts.ready;
    const canvas = document.querySelector('canvas.mascot-canvas');
    const deadline = performance.now() + 2200;
    while (canvas && Number.parseInt(canvas.dataset.motionTick ?? '0', 10) < 24 && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      renderer: canvas?.dataset.renderer ?? null,
      visualProfile: canvas?.dataset.visualProfile ?? null,
      stage: document.querySelector('.presence-character-stage')?.getBoundingClientRect().toJSON() ?? null,
    };
  })()`);
  await setPreviewTheme('Dark', 'dark');
  await capture('01-full-home-dark.png', 'Full home in bold dark mode with dominant real 3D companion');

  await setPreviewTheme('Light', 'light');
  await capture('02-full-home-light.png', 'Full home in bold light mode with dominant real 3D companion');

  await setPreviewTheme('Dark', 'dark');

  await evaluate(`document.querySelector('button[aria-label="Open compact work beside me mode"]')?.click()`);
  await waitForPreview(650);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await capture('03-compact-character-chat.png', 'Compact work-beside-me mode: character and small chat only');

  await evaluate(`document.querySelector('.compact-toolbar button[aria-label="Show quick settings"]')?.focus()`);
  await capture('04-compact-controls-revealed.png', 'Compact mode with unobtrusive controls intentionally revealed');

  await evaluate(`document.querySelector('button[aria-label="Use character-only corner mode"]')?.click()`);
  await waitForPreview(650);
  await evaluate(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
  await capture('05-character-only.png', 'Smallest character-only corner mode');

  setNativeWindowMode(WINDOW_MODE.FULL);
  await waitForPreview(650);
  const fullSettingsEvidence = await evaluate(`(async () => {
    const openSettingsButton = document.querySelector('button[aria-label="Open settings"]');
    openSettingsButton?.click();
    const settingsDeadline = performance.now() + 1200;
    while (!document.querySelector('aside.drawer.open[aria-label="Settings"]') && performance.now() < settingsDeadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      opened: Boolean(document.querySelector('aside.drawer.open[aria-label="Settings"]')),
      fullShellPresent: Boolean(document.querySelector('.app-shell')),
      rendererMode: document.querySelector('[data-window-mode]')?.getAttribute('data-window-mode') ?? 'full',
      openSettingsButtonPresent: Boolean(openSettingsButton),
    };
  })()`);
  if (!fullSettingsEvidence.opened) throw new Error(`Full settings preview did not open after restoring full mode: ${JSON.stringify(fullSettingsEvidence)}`);
  await waitForPreview(700);
  await capture('06-settings-and-privacy.png', 'Full settings, theme, and private-space controls');

  await evaluate(`document.querySelector('button[aria-label="Close settings"]')?.click()`);
  await waitForPreview(180);
  await evaluate(`Array.from(document.querySelectorAll('button.rail-button')).find((button) => button.querySelector('.rail-copy strong')?.textContent?.trim() === 'Play')?.click()`);
  const activityOpened = await evaluate(`(async () => {
    const deadline = performance.now() + 1200;
    while (!document.querySelector('.game-drawer.open') && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return Boolean(document.querySelector('.game-drawer.open'));
  })()`);
  if (!activityOpened) throw new Error('Activities preview drawer did not open.');
  await capture('07-activities-and-emotion.png', 'Offline activities and expressive companion state');

  await evaluate(`document.querySelector('button[aria-label="Close games"]')?.click()`);
  await waitForPreview(180);
  await evaluate(`(async () => {
    const textarea = document.querySelector('textarea#message');
    const form = document.querySelector('form.composer');
    const prompt = 'I feel overwhelmed and I am scared I might hurt myself tonight.';
    const setter = textarea ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set : null;
    if (textarea && setter) {
      setter.call(textarea, prompt);
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (typeof form?.requestSubmit === 'function') form.requestSubmit();
      else form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    const deadline = performance.now() + 2500;
    while (!document.querySelector('.safety-corner.attention') && performance.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    document.querySelector('.safety-corner.attention > summary')?.click();
    return Boolean(document.querySelector('.safety-corner.attention'));
  })()`);
  await waitForPreview(550);
  await capture('08-urgent-support-keeps-talking.png', 'Urgent support remains visible without replacing the conversation');

  const manifest = {
    schema: 1,
    status: 'owner-visual-review-required',
    packagePromoted: false,
    sourceVersion: '0.2.12-owner-test-candidate',
    generatedAt: new Date().toISOString(),
    isolatedUserData: 'temporary isolated preview profile (not included)',
    captures,
  };
  fs.writeFileSync(path.join(previewRoot, 'VISUAL-PREVIEW-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  process.stdout.write(`WELLBEING_COMPANION_VISUAL_PREVIEW_OK ${JSON.stringify(manifest)}\n`);
  quitApproved = true;
  localVoiceBridge?.cancelAll();
  mainWindow.destroy();
  await stopBundledRuntime(bundledRuntime);
  app.exit(0);
}

async function writeVisualPreviewFailureAndExit(error) {
  const previewRoot = path.resolve(visualPreviewDirectory);
  const result = {
    schema: 1,
    status: 'error',
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorMessage: error instanceof Error ? error.message : String(error),
  };
  fs.mkdirSync(previewRoot, { recursive: true });
  fs.writeFileSync(path.join(previewRoot, 'VISUAL-PREVIEW-ERROR.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stderr.write(`WELLBEING_COMPANION_VISUAL_PREVIEW_ERROR ${JSON.stringify(result)}\n`);
  quitApproved = true;
  await stopBundledRuntime(bundledRuntime);
  app.exit(1);
}

async function createWindow() {
  const icon = createBrandIcon();
  const iconPath = path.join(__dirname, 'assets', 'wellbeing-companion-icon.png');
  const iconSize = icon.getSize();
  brandIconEvidence = Object.freeze({
    sourceFile: 'desktop/assets/wellbeing-companion-icon.png',
    sourceExists: fs.existsSync(iconPath),
    sourceBytes: fs.existsSync(iconPath) ? fs.statSync(iconPath).size : 0,
    decodedIconEmpty: icon.isEmpty(),
    decodedWidth: iconSize.width,
    decodedHeight: iconSize.height,
    windowIconConfigured: true,
    trayIconConfigured: true,
  });
  const windowPresentation = resolveWindowPresentation(smokeMode);
  createTray(icon);
  createMenus();
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    ...windowPresentation.window,
    show: visualPreviewMode ? false : windowPresentation.window.show,
    backgroundColor: '#21162a',
    icon,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.cjs'),
      ...CONFIGURED_SECURITY,
      ...windowPresentation.webPreferences,
      backgroundThrottling: visualPreviewMode ? false : windowPresentation.webPreferences.backgroundThrottling,
      offscreen: visualPreviewMode,
      spellcheck: true,
    },
  });
  setNativeWindowMode(initialWindowMode);
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_NAME);
  });
  if (smokeMode) mainWindow.setIgnoreMouseEvents(true);
  mainWindow.on('minimize', (event) => {
    if (smokeMode || visualPreviewMode) return;
    event.preventDefault();
    hideToTray();
  });
  mainWindow.on('close', (event) => {
    if (quitApproved || sessionEnding || smokeMode || visualPreviewMode) return;
    event.preventDefault();
    void handleWindowCloseRequest();
  });
  mainWindow.on('query-session-end', () => {
    sessionEnding = true;
    quitApproved = true;
    localVoiceBridge?.cancelAll();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.on('will-navigate', (event, candidate) => {
    if (isSameAppOrigin(candidate, BUNDLED_TARGET_URL)) return;
    event.preventDefault();
    disarmMicrophone();
    localVoiceBridge?.cancelAll();
    void askBeforeOpeningExternal(candidate);
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) localVoiceBridge?.cancelAll();
  });
  mainWindow.webContents.on('render-process-gone', () => localVoiceBridge?.cancelAll());
  mainWindow.webContents.on('destroyed', () => localVoiceBridge?.cancelAll());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void askBeforeOpeningExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('did-fail-load', async (_event, errorCode, _description, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || smokeMode || visualPreviewMode) return;
    await mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (smokeMode) {
      if (!smokeMode || !isSameAppOrigin(mainWindow.webContents.getURL(), BUNDLED_TARGET_URL)) return;
      setTimeout(() => void writeSmokeResultAndExit(), 150);
      return;
    }
    if (visualPreviewMode && isSameAppOrigin(mainWindow.webContents.getURL(), BUNDLED_TARGET_URL)) {
      setTimeout(() => void runVisualPreviewCapture().catch(writeVisualPreviewFailureAndExit), 300);
    }
  });
  mainWindow.once('ready-to-show', () => {
    if (!smokeMode && !visualPreviewMode) mainWindow.show();
  });
  if (gpuSandboxCompatibility.startupSettleMs > 0) await waitFor(gpuSandboxCompatibility.startupSettleMs);
  const initialRendererTarget = new URL(BUNDLED_TARGET_URL);
  initialRendererTarget.searchParams.set('layout', initialWindowMode);
  initialNavigationEvidence = await loadInitialTargetWithRetry({
    load: () => mainWindow.loadURL(initialRendererTarget.toString()),
    wait: waitFor,
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on('second-instance', showWindow);
app.on('window-all-closed', () => {});
app.on('before-quit', (event) => {
  if (quitApproved || sessionEnding) return;
  event.preventDefault();
  void confirmRealExit();
});
app.on('will-quit', () => {
  disarmMicrophone();
  localVoiceBridge?.dispose();
  void stopBundledRuntime(bundledRuntime);
});

app.whenReady().then(async () => {
  try {
    createOwnerMarker();
    bundledRuntime = await startBundledRuntime();
    await configureSecurityControls();
    runtimeWarmupEvidence = await warmRendererSessionRuntime();
    localModelBridge = createLocalModelBridge({ fetchImpl: net.fetch });
    const localVoiceProvider = smokeMode || visualPreviewMode
      ? createUnavailableLocalVoiceProvider()
      : createChatterboxLocalVoiceProvider({
        runtimeRoot: path.join(app.getPath('userData'), 'VoiceRuntime'),
      });
    localVoiceBridge = createLocalVoiceBridge({
      provider: localVoiceProvider,
      approvedProviderId: smokeMode || visualPreviewMode ? null : CHATTERBOX_PROVIDER_ID,
      speakTimeoutMs: 75_000,
    });
    registerIpc();
    await createWindow();
  } catch (error) {
    if (smokeMode) return writeSmokeFailureAndExit(error);
    if (visualPreviewMode) return writeVisualPreviewFailureAndExit(error);
    dialog.showErrorBox('The wellbeing companion could not start', error instanceof Error ? error.message : String(error));
    quitApproved = true;
    localVoiceBridge?.dispose();
    app.exit(1);
  }
});
