'use strict';

// Electron 43's sandboxed GPU and renderer child processes currently fail to
// launch on the Windows Insider 25H2 build family. Keep this exception
// deliberately small and observable in the packaged-process receipt. Context
// isolation stays enabled, Node integration stays disabled, webviews stay
// disabled, and the renderer remains restricted to the fixed loopback origin.
const AFFECTED_WINDOWS_BUILD_MIN = 26200;
const AFFECTED_WINDOWS_BUILD_MAX = 26399;
const FORCE_GPU_SANDBOX_ARGUMENT = '--force-gpu-sandbox';
const FORCE_GPU_SANDBOX_ENVIRONMENT = 'COMPANION_FORCE_GPU_SANDBOX';
const AFFECTED_BUILD_STARTUP_SETTLE_MS = 500;

function parseWindowsBuild(release) {
  if (typeof release !== 'string') return null;
  const match = /^(?:\d+\.){2}(\d+)(?:\.|$)/.exec(release.trim());
  if (!match) return null;
  const build = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(build) ? build : null;
}

function isForceGpuSandboxRequested({ argv = [], env = {} } = {}) {
  return Array.isArray(argv) && argv.includes(FORCE_GPU_SANDBOX_ARGUMENT)
    || env?.[FORCE_GPU_SANDBOX_ENVIRONMENT] === '1';
}

function resolveGpuSandboxCompatibility({ platform, release, argv, env } = {}) {
  const windowsBuild = platform === 'win32' ? parseWindowsBuild(release) : null;
  const forceGpuSandbox = isForceGpuSandboxRequested({ argv, env });
  const affectedWindowsBuild = windowsBuild !== null
    && windowsBuild >= AFFECTED_WINDOWS_BUILD_MIN
    && windowsBuild <= AFFECTED_WINDOWS_BUILD_MAX;
  const disableGpuSandbox = platform === 'win32' && affectedWindowsBuild && !forceGpuSandbox;
  const disableRendererSandbox = platform === 'win32' && affectedWindowsBuild && !forceGpuSandbox;

  return Object.freeze({
    disableGpuSandbox,
    disableRendererSandbox,
    forceGpuSandbox,
    platform: platform ?? null,
    windowsBuild,
    affectedWindowsBuild,
    affectedWindowsBuildRange: `${AFFECTED_WINDOWS_BUILD_MIN}-${AFFECTED_WINDOWS_BUILD_MAX}`,
    startupSettleMs: disableGpuSandbox ? AFFECTED_BUILD_STARTUP_SETTLE_MS : 0,
    rendererSandboxUnaffected: !disableRendererSandbox,
    reason: disableGpuSandbox || disableRendererSandbox
      ? 'Windows 25H2 GPU and renderer child-process compatibility path for Electron 43'
      : forceGpuSandbox
        ? 'GPU and renderer sandboxes explicitly forced for compatibility retesting'
        : 'GPU and renderer sandbox compatibility path not required',
  });
}

module.exports = {
  AFFECTED_BUILD_STARTUP_SETTLE_MS,
  AFFECTED_WINDOWS_BUILD_MAX,
  AFFECTED_WINDOWS_BUILD_MIN,
  FORCE_GPU_SANDBOX_ARGUMENT,
  FORCE_GPU_SANDBOX_ENVIRONMENT,
  isForceGpuSandboxRequested,
  parseWindowsBuild,
  resolveGpuSandboxCompatibility,
};
