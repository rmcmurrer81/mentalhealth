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

module.exports = {
  CloseAction,
  closeDialogResponseToAction,
  quitDialogResponseIsConfirmed,
};
