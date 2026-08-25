'use strict';

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
  session,
  shell,
  Tray,
} = require('electron');
const {
  CloseAction,
  closeDialogResponseToAction,
  quitDialogResponseIsConfirmed,
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
  BUNDLED_TARGET_URL,
  HEALTH_PATH,
  startBundledRuntime,
  stopBundledRuntime,
} = require('./runtime.cjs');
const { resolveGpuSandboxCompatibility } = require('./gpu-sandbox-compatibility.cjs');
const { loadInitialTargetWithRetry, waitFor } = require('./startup-retry.cjs');

const APP_NAME = 'Wellbeing Companion — Working Title';
const APP_FOLDER = 'WellbeingCompanionWorkingTitle';
const APP_USER_MODEL_ID = 'com.kiralabs.wellbeing-companion-working-title';
const PARTITION = 'persist:wellbeing-companion-working-title';
const MICROPHONE_ARM_MS = 20_000;
const CONFIGURED_SECURITY = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webviewTag: false,
  navigateOnDragDrop: false,
});
const smokeMode = process.argv.includes('--smoke-test');
const gpuSandboxCompatibility = resolveGpuSandboxCompatibility({
  platform: process.platform,
  release: os.release(),
  argv: process.argv,
  env: process.env,
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

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
if (gpuSandboxCompatibility.disableGpuSandbox) app.commandLine.appendSwitch('disable-gpu-sandbox');
app.enableSandbox();

if (smokeMode) {
  const smokeUserData = process.env.COMPANION_SMOKE_USER_DATA;
  if (!smokeUserData) throw new Error('COMPANION_SMOKE_USER_DATA is required in smoke mode.');
  fs.mkdirSync(path.resolve(smokeUserData), { recursive: true });
  app.setPath('userData', path.resolve(smokeUserData));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), APP_FOLDER, 'UserData'));
}

function findArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(`${prefix}=`));
  return argument?.slice(prefix.length + 1);
}

function createOwnerMarker() {
  if (smokeMode) return;
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
      mainWindow.webContents.executeJavaScript(`(() => {
        const key = '__wellbeing_companion_isolated_smoke__';
        localStorage.setItem(key, 'round-trip-ok');
        const value = localStorage.getItem(key);
        localStorage.removeItem(key);
        return {
          locationProtocol: location.protocol,
          requireType: typeof require,
          processType: typeof process,
          documentReadyState: document.readyState,
          documentTitle: document.title,
          workingTitlePresent: document.body.innerText.includes('WORKING TITLE'),
          localStorageRoundTrip: value
        };
      })()`),
      new Promise((resolve) => setTimeout(() => resolve({ probeTimedOut: true }), 2_000)),
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
    rendererProbe,
    bundledRuntimeStarted: Boolean(bundledRuntime?.server?.listening),
    bundledRuntimeEvidence,
    configuredSecurity: { ...CONFIGURED_SECURITY },
    permissionBoundary: {
      microphoneRequiresExplicitHandsFreeIpc: true,
      microphoneApprovedAtStartup: microphoneApprovedForSession,
      microphoneArmedAtStartup: permissionMayUseMicrophone({ approved: microphoneApprovedForSession, armedUntil: microphoneArmedUntil }),
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
    gpuSandboxCompatibility: getGpuSandboxCompatibilityEvidence(),
  };
  if (resultPath) fs.writeFileSync(path.resolve(resultPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stderr.write(`WELLBEING_COMPANION_DESKTOP_SMOKE_ERROR ${JSON.stringify(result)}\n`);
  quitApproved = true;
  await stopBundledRuntime(bundledRuntime);
  app.exit(1);
}

async function createWindow() {
  const icon = createBrandIcon();
  createTray(icon);
  createMenus();
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#21162a',
    icon,
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.cjs'),
      ...CONFIGURED_SECURITY,
      spellcheck: true,
    },
  });
  mainWindow.on('minimize', (event) => {
    if (smokeMode) return;
    event.preventDefault();
    hideToTray();
  });
  mainWindow.on('close', (event) => {
    if (quitApproved || sessionEnding || smokeMode) return;
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
    if (!isMainFrame || errorCode === -3 || smokeMode) return;
    await mainWindow.loadFile(path.join(__dirname, 'offline.html'));
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (smokeMode) setTimeout(() => void writeSmokeResultAndExit(), 150);
  });
  mainWindow.once('ready-to-show', () => {
    if (!smokeMode) mainWindow.show();
  });
  if (gpuSandboxCompatibility.startupSettleMs > 0) await waitFor(gpuSandboxCompatibility.startupSettleMs);
  initialNavigationEvidence = await loadInitialTargetWithRetry({
    load: () => mainWindow.loadURL(BUNDLED_TARGET_URL),
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
    localModelBridge = createLocalModelBridge({ fetchImpl: net.fetch });
    localVoiceBridge = createLocalVoiceBridge({
      provider: createUnavailableLocalVoiceProvider(),
      approvedProviderId: null,
    });
    registerIpc();
    await createWindow();
  } catch (error) {
    if (smokeMode) return writeSmokeFailureAndExit(error);
    dialog.showErrorBox('The wellbeing companion could not start', error instanceof Error ? error.message : String(error));
    quitApproved = true;
    localVoiceBridge?.dispose();
    app.exit(1);
  }
});
