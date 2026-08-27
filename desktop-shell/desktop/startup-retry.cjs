'use strict';

// Electron's Windows network service can report ERR_FAILED briefly after an
// isolated persistent partition is created even though the loopback listener is
// already accepting requests. Keep this bounded below the packaged-smoke timeout,
// but allow enough time for a busy Windows desktop to settle.
const INITIAL_NAVIGATION_RETRY_COUNT = 24;
const INITIAL_NAVIGATION_RETRY_DELAY_MS = 250;

function isRetryableInitialNavigationError(error) {
  return Boolean(error && typeof error.message === 'string' && error.message.includes('ERR_FAILED (-2)'));
}

async function loadInitialTargetWithRetry({ load, wait, retries = INITIAL_NAVIGATION_RETRY_COUNT, delayMs = INITIAL_NAVIGATION_RETRY_DELAY_MS }) {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      await load();
      return Object.freeze({ attempts: retryCount + 1, retries: retryCount, retryDelayMs: delayMs });
    } catch (error) {
      const retryable = isRetryableInitialNavigationError(error);
      if (!retryable || retryCount >= retries) {
        if (retryable && error && typeof error === 'object') {
          error.navigationRetryEvidence = Object.freeze({
            attempts: retryCount + 1,
            retries: retryCount,
            retryDelayMs: delayMs,
            exhausted: true,
          });
        }
        throw error;
      }
      await wait(delayMs);
    }
  }
}

function waitFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
  INITIAL_NAVIGATION_RETRY_COUNT,
  INITIAL_NAVIGATION_RETRY_DELAY_MS,
  isRetryableInitialNavigationError,
  loadInitialTargetWithRetry,
  waitFor,
};
