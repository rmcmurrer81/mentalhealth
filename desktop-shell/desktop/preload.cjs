'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wellbeingDesktop', Object.freeze({
  requestHandsFreePermission: () => ipcRenderer.invoke('wellbeing:request-hands-free'),
  armMicrophone: () => ipcRenderer.invoke('wellbeing:arm-microphone'),
  disarmMicrophone: () => ipcRenderer.send('wellbeing:disarm-microphone'),
  localSpeech: Object.freeze({
    status: () => ipcRenderer.invoke('wellbeing:local-speech-status'),
    transcribe: (request) => ipcRenderer.invoke('wellbeing:local-speech-transcribe', request),
  }),
  setWindowMode: (mode) => ipcRenderer.invoke('wellbeing:set-window-mode', mode),
  onWindowModeChanged: (listener) => {
    const handler = (_event, mode) => {
      if (mode === 'full' || mode === 'compact' || mode === 'character') listener(mode);
    };
    ipcRenderer.on('wellbeing:window-mode-changed', handler);
    return () => ipcRenderer.removeListener('wellbeing:window-mode-changed', handler);
  },
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('wellbeing:set-always-on-top', enabled),
  hideWindow: () => ipcRenderer.send('wellbeing:hide-window'),
  localVoice: Object.freeze({
    status: () => ipcRenderer.invoke('wellbeing:local-voice-status'),
    speak: (request) => ipcRenderer.invoke('wellbeing:local-voice-speak', request),
    cancel: (requestId) => ipcRenderer.invoke('wellbeing:local-voice-cancel', requestId),
    onPlaybackStart: (listener) => {
      const handler = (_event, value) => listener(value);
      ipcRenderer.on('wellbeing:local-voice-playback-start', handler);
      return () => ipcRenderer.removeListener('wellbeing:local-voice-playback-start', handler);
    },
  }),
  localModel: Object.freeze({
    status: () => ipcRenderer.invoke('wellbeing:local-model-status'),
    enhanceSteadyReply: (request) => ipcRenderer.invoke('wellbeing:local-model-enhance-steady', request),
  }),
  runtime: 'native-windows-local',
}));
