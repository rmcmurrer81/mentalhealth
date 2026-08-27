'use strict';

const CloseAction = Object.freeze({
  HIDE: 'hide',
  QUIT: 'quit',
  CANCEL: 'cancel',
});

function closeDialogResponseToAction(response) {
  if (response === 0) return CloseAction.HIDE;
  if (response === 1) return CloseAction.QUIT;
  return CloseAction.CANCEL;
}

function quitDialogResponseIsConfirmed(response) {
  return response === 0;
}

function resolveWindowPresentation(smokeMode) {
  if (typeof smokeMode !== 'boolean') throw new TypeError('smokeMode must be a boolean.');
  return Object.freeze({
    window: Object.freeze({
      show: smokeMode,
      opacity: smokeMode ? 0 : 1,
      skipTaskbar: smokeMode,
      focusable: !smokeMode,
    }),
    webPreferences: Object.freeze({
      backgroundThrottling: !smokeMode,
    }),
  });
}

module.exports = {
  CloseAction,
  closeDialogResponseToAction,
  quitDialogResponseIsConfirmed,
  resolveWindowPresentation,
};
