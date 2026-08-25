'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { CloseAction, closeDialogResponseToAction, quitDialogResponseIsConfirmed } = require('../desktop/lifecycle.cjs');
const { parseWindowsBuild, resolveGpuSandboxCompatibility } = require('../desktop/gpu-sandbox-compatibility.cjs');
const { isRetryableInitialNavigationError, loadInitialTargetWithRetry } = require('../desktop/startup-retry.cjs');

test('close and quit choices keep preserve-first lifecycle explicit', () => {
  assert.equal(closeDialogResponseToAction(0), CloseAction.HIDE);
  assert.equal(closeDialogResponseToAction(1), CloseAction.QUIT);
  assert.equal(closeDialogResponseToAction(2), CloseAction.CANCEL);
  assert.equal(quitDialogResponseIsConfirmed(0), true);
  assert.equal(quitDialogResponseIsConfirmed(1), false);
});

test('GPU compatibility is bounded to the known Windows build family', () => {
  assert.equal(parseWindowsBuild('10.0.26200'), 26200);
  assert.equal(resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: [], env: {} }).disableGpuSandbox, true);
  assert.equal(resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26400', argv: [], env: {} }).disableGpuSandbox, false);
  assert.equal(resolveGpuSandboxCompatibility({ platform: 'linux', release: '6.1.0', argv: [], env: {} }).disableGpuSandbox, false);
  assert.equal(resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: ['--force-gpu-sandbox'], env: {} }).disableGpuSandbox, false);
  assert.equal(resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: [], env: { COMPANION_FORCE_GPU_SANDBOX: '1' } }).disableGpuSandbox, false);
});

test('initial navigation retries only the bounded Electron startup failure', async () => {
  assert.equal(isRetryableInitialNavigationError(new Error('ERR_FAILED (-2)')), true);
  assert.equal(isRetryableInitialNavigationError(new Error('ERR_CONNECTION_REFUSED (-102)')), false);
  let calls = 0;
  const waits = [];
  const result = await loadInitialTargetWithRetry({
    load: async () => {
      calls += 1;
      if (calls < 3) throw new Error('ERR_FAILED (-2)');
    },
    wait: async (ms) => waits.push(ms),
    retries: 3,
    delayMs: 4,
  });
  assert.deepEqual(result, { attempts: 3, retries: 2, retryDelayMs: 4 });
  assert.deepEqual(waits, [4, 4]);
});
