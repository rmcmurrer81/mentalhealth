'use strict';

const WINDOW_MODE = Object.freeze({ FULL: 'full', COMPACT: 'compact', CHARACTER: 'character' });
const FULL_MINIMUM = Object.freeze({ width: 960, height: 680 });
const COMPACT_MINIMUM = Object.freeze({ width: 380, height: 560 });
const COMPACT_TARGET = Object.freeze({ width: 440, height: 760, margin: 18 });
const CHARACTER_MINIMUM = Object.freeze({ width: 300, height: 340 });
const CHARACTER_TARGET = Object.freeze({ width: 340, height: 440, margin: 18 });

function assertWindowMode(mode) {
  if (!Object.values(WINDOW_MODE).includes(mode)) throw new TypeError('Window mode must be full, compact, or character.');
  return mode;
}

function defaultAlwaysOnTopForMode(mode) {
  assertWindowMode(mode);
  return mode !== WINDOW_MODE.FULL;
}

function characterBoundsForWorkArea(workArea) {
  if (!workArea || !Number.isFinite(workArea.x) || !Number.isFinite(workArea.y)
    || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)
    || workArea.width < CHARACTER_MINIMUM.width || workArea.height < CHARACTER_MINIMUM.height) {
    throw new TypeError('A valid display work area is required for character mode.');
  }
  const width = Math.min(CHARACTER_TARGET.width, workArea.width);
  const height = Math.min(CHARACTER_TARGET.height, workArea.height);
  return {
    x: workArea.x + workArea.width - width - Math.min(CHARACTER_TARGET.margin, Math.max(0, workArea.width - width)),
    y: workArea.y + Math.min(CHARACTER_TARGET.margin, Math.max(0, workArea.height - height)),
    width,
    height,
  };
}

function compactBoundsForWorkArea(workArea) {
  if (!workArea || !Number.isFinite(workArea.x) || !Number.isFinite(workArea.y)
    || !Number.isFinite(workArea.width) || !Number.isFinite(workArea.height)
    || workArea.width < COMPACT_MINIMUM.width || workArea.height < COMPACT_MINIMUM.height) {
    throw new TypeError('A valid display work area is required for compact mode.');
  }
  const width = Math.min(COMPACT_TARGET.width, workArea.width);
  const height = Math.min(COMPACT_TARGET.height, workArea.height);
  const margin = Math.min(COMPACT_TARGET.margin, Math.max(0, workArea.width - width));
  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + Math.min(COMPACT_TARGET.margin, Math.max(0, workArea.height - height)),
    width,
    height,
  };
}

function applyWindowMode(browserWindow, mode, workArea, restoreBounds) {
  assertWindowMode(mode);
  if (!browserWindow || typeof browserWindow.setBounds !== 'function' || typeof browserWindow.setMinimumSize !== 'function') {
    throw new TypeError('A live native window is required.');
  }
  if (mode === WINDOW_MODE.COMPACT) {
    const bounds = compactBoundsForWorkArea(workArea);
    browserWindow.setMinimumSize(COMPACT_MINIMUM.width, COMPACT_MINIMUM.height);
    browserWindow.setBounds(bounds, true);
    return { mode, bounds, minimum: COMPACT_MINIMUM };
  }
  if (mode === WINDOW_MODE.CHARACTER) {
    const bounds = characterBoundsForWorkArea(workArea);
    browserWindow.setMinimumSize(CHARACTER_MINIMUM.width, CHARACTER_MINIMUM.height);
    browserWindow.setBounds(bounds, true);
    return { mode, bounds, minimum: CHARACTER_MINIMUM };
  }
  browserWindow.setMinimumSize(FULL_MINIMUM.width, FULL_MINIMUM.height);
  const bounds = restoreBounds && restoreBounds.width >= FULL_MINIMUM.width && restoreBounds.height >= FULL_MINIMUM.height
    ? restoreBounds
    : { width: 1440, height: 940 };
  browserWindow.setBounds(bounds, true);
  return { mode, bounds, minimum: FULL_MINIMUM };
}

module.exports = {
  CHARACTER_MINIMUM,
  CHARACTER_TARGET,
  COMPACT_MINIMUM,
  COMPACT_TARGET,
  FULL_MINIMUM,
  WINDOW_MODE,
  applyWindowMode,
  assertWindowMode,
  compactBoundsForWorkArea,
  characterBoundsForWorkArea,
  defaultAlwaysOnTopForMode,
};
