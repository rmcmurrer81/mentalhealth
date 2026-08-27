'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CHARACTER_MINIMUM,
  COMPACT_MINIMUM,
  FULL_MINIMUM,
  WINDOW_MODE,
  applyWindowMode,
  assertWindowMode,
  characterBoundsForWorkArea,
  compactBoundsForWorkArea,
  defaultAlwaysOnTopForMode,
} = require('../desktop/window-mode.cjs');

function fakeWindow() {
  const calls = [];
  return {
    calls,
    setMinimumSize: (width, height) => calls.push(['minimum', width, height]),
    setBounds: (bounds, animate) => calls.push(['bounds', bounds, animate]),
  };
}

const workArea = { x: 100, y: 40, width: 1820, height: 1000 };

test('window modes are strict and never accept an arbitrary renderer value', () => {
  assert.equal(assertWindowMode('full'), 'full');
  assert.equal(assertWindowMode('compact'), 'compact');
  assert.equal(assertWindowMode('character'), 'character');
  assert.throws(() => assertWindowMode('tiny-but-untrusted'), /full, compact, or character/);
});

test('work-beside-me modes default to always-on-top while full mode does not', () => {
  assert.equal(defaultAlwaysOnTopForMode(WINDOW_MODE.COMPACT), true);
  assert.equal(defaultAlwaysOnTopForMode(WINDOW_MODE.CHARACTER), true);
  assert.equal(defaultAlwaysOnTopForMode(WINDOW_MODE.FULL), false);
  assert.throws(() => defaultAlwaysOnTopForMode('floating-but-untrusted'), /full, compact, or character/);
});

test('compact work-beside-me bounds stay inside the current display', () => {
  const bounds = compactBoundsForWorkArea(workArea);
  assert.equal(bounds.width, 440);
  assert.equal(bounds.height, 760);
  assert.ok(bounds.x >= workArea.x && bounds.x + bounds.width <= workArea.x + workArea.width);
  assert.ok(bounds.y >= workArea.y && bounds.y + bounds.height <= workArea.y + workArea.height);
  const window = fakeWindow();
  const result = applyWindowMode(window, WINDOW_MODE.COMPACT, workArea);
  assert.deepEqual(result.minimum, COMPACT_MINIMUM);
  assert.deepEqual(window.calls[0], ['minimum', COMPACT_MINIMUM.width, COMPACT_MINIMUM.height]);
  assert.deepEqual(window.calls[1], ['bounds', bounds, true]);
});

test('character-only mode is smaller but remains usable and on-screen', () => {
  const bounds = characterBoundsForWorkArea(workArea);
  assert.equal(bounds.width, 340);
  assert.equal(bounds.height, 440);
  const window = fakeWindow();
  const result = applyWindowMode(window, WINDOW_MODE.CHARACTER, workArea);
  assert.deepEqual(result.minimum, CHARACTER_MINIMUM);
  assert.ok(result.bounds.width < compactBoundsForWorkArea(workArea).width);
  assert.ok(result.bounds.height < compactBoundsForWorkArea(workArea).height);
});

test('full mode restores a valid prior bound and rejects undersized restoration', () => {
  const valid = { x: 160, y: 90, width: 1360, height: 860 };
  const window = fakeWindow();
  const restored = applyWindowMode(window, WINDOW_MODE.FULL, workArea, valid);
  assert.deepEqual(restored.minimum, FULL_MINIMUM);
  assert.deepEqual(restored.bounds, valid);
  const fallback = applyWindowMode(fakeWindow(), WINDOW_MODE.FULL, workArea, { width: 400, height: 300 });
  assert.deepEqual(fallback.bounds, { width: 1440, height: 940 });
});
