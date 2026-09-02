'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CloseAction,
  closeDialogResponseToAction,
  quitDialogResponseIsConfirmed,
  resolveWindowPresentation,
} = require('../desktop/lifecycle.cjs');
const { parseWindowsBuild, resolveGpuSandboxCompatibility } = require('../desktop/gpu-sandbox-compatibility.cjs');
const { isRetryableInitialNavigationError, loadInitialTargetWithRetry } = require('../desktop/startup-retry.cjs');

test('close and quit choices keep preserve-first lifecycle explicit', () => {
  assert.equal(closeDialogResponseToAction(0), CloseAction.HIDE);
  assert.equal(closeDialogResponseToAction(1), CloseAction.QUIT);
  assert.equal(closeDialogResponseToAction(2), CloseAction.CANCEL);
  assert.equal(quitDialogResponseIsConfirmed(0), true);
  assert.equal(quitDialogResponseIsConfirmed(1), false);
  assert.deepEqual(resolveWindowPresentation(true), {
    window: { show: false, opacity: 1, skipTaskbar: true, focusable: false },
    webPreferences: { backgroundThrottling: false },
  });
  assert.deepEqual(resolveWindowPresentation(false), {
    window: { show: false, opacity: 1, skipTaskbar: false, focusable: true },
    webPreferences: { backgroundThrottling: true },
  });
  assert.throws(() => resolveWindowPresentation('true'), /smokeMode must be a boolean/);
});

test('GPU compatibility is bounded to the known Windows build family', () => {
  assert.equal(parseWindowsBuild('10.0.26200'), 26200);
  const affected = resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: [], env: {} });
  assert.equal(affected.disableGpuSandbox, true);
  assert.equal(affected.disableRendererSandbox, true);
  assert.equal(affected.rendererSandboxUnaffected, false);
  assert.equal(affected.affectedWindowsBuild, true);
  for (const result of [
    resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26400', argv: [], env: {} }),
    resolveGpuSandboxCompatibility({ platform: 'linux', release: '6.1.0', argv: [], env: {} }),
    resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: ['--force-gpu-sandbox'], env: {} }),
    resolveGpuSandboxCompatibility({ platform: 'win32', release: '10.0.26200', argv: [], env: { COMPANION_FORCE_GPU_SANDBOX: '1' } }),
  ]) {
    assert.equal(result.disableGpuSandbox, false);
    assert.equal(result.disableRendererSandbox, false);
    assert.equal(result.rendererSandboxUnaffected, true);
  }
});

test('initial navigation retries only the bounded Electron startup failure', async () => {
  assert.equal(isRetryableInitialNavigationError(new Error('ERR_FAILED (-2)')), true);
  assert.equal(isRetryableInitialNavigationError({ message: "ERR_FAILED (-2) loading 'http://127.0.0.1:43724/'" }), true);
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

test('initial navigation retry window outlasts the former eight-retry startup race', async () => {
  let calls = 0;
  const waits = [];
  const result = await loadInitialTargetWithRetry({
    load: async () => {
      calls += 1;
      if (calls <= 9) throw new Error('ERR_FAILED (-2)');
    },
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(calls, 10);
  assert.deepEqual(result, { attempts: 10, retries: 9, retryDelayMs: 250 });
  assert.equal(waits.length, 9);
  assert.ok(waits.every((value) => value === 250));
});

test('exhausted startup navigation exposes bounded retry evidence', async () => {
  await assert.rejects(
    loadInitialTargetWithRetry({
      load: async () => { throw new Error('ERR_FAILED (-2)'); },
      wait: async () => {},
      retries: 2,
      delayMs: 3,
    }),
    (error) => {
      assert.deepEqual(error.navigationRetryEvidence, {
        attempts: 3,
        retries: 2,
        retryDelayMs: 3,
        exhausted: true,
      });
      return true;
    },
  );
});
