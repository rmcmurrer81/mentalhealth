'use strict';

const INITIAL_NAVIGATION_RETRY_COUNT = 8;
const INITIAL_NAVIGATION_RETRY_DELAY_MS = 125;

function isRetryableInitialNavigationError(error) {
  return error instanceof Error && error.message.includes('ERR_FAILED (-2)');
}

async function loadInitialTargetWithRetry({ load, wait, retries = INITIAL_NAVIGATION_RETRY_COUNT, delayMs = INITIAL_NAVIGATION_RETRY_DELAY_MS }) {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      await load();
      return Object.freeze({ attempts: retryCount + 1, retries: retryCount, retryDelayMs: delayMs });
    } catch (error) {
      if (!isRetryableInitialNavigationError(error) || retryCount >= retries) throw error;
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
