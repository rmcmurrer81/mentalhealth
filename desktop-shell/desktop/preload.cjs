'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wellbeingDesktop', Object.freeze({
  requestHandsFreePermission: () => ipcRenderer.invoke('wellbeing:request-hands-free'),
  armMicrophone: () => ipcRenderer.invoke('wellbeing:arm-microphone'),
  disarmMicrophone: () => ipcRenderer.send('wellbeing:disarm-microphone'),
  localVoice: Object.freeze({
    status: () => ipcRenderer.invoke('wellbeing:local-voice-status'),
    speak: (request) => ipcRenderer.invoke('wellbeing:local-voice-speak', request),
    cancel: (requestId) => ipcRenderer.invoke('wellbeing:local-voice-cancel', requestId),
  }),
  localModel: Object.freeze({
    status: () => ipcRenderer.invoke('wellbeing:local-model-status'),
    enhanceSteadyReply: (request) => ipcRenderer.invoke('wellbeing:local-model-enhance-steady', request),
  }),
  runtime: 'native-windows-local',
}));
