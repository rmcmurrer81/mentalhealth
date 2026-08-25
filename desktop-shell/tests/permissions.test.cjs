'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isAudioOnlyCheck,
  isAudioOnlyPermission,
  isSameAppOrigin,
  isTrustedIpcEvent,
  permissionMayUseMicrophone,
} = require('../desktop/permissions.cjs');

const target = 'http://127.0.0.1:43724/';

test('origin checks require exact scheme host and port with no credentials', () => {
  assert.equal(isSameAppOrigin('http://127.0.0.1:43724/talk', target), true);
  assert.equal(isSameAppOrigin('http://localhost:43724/', target), false);
  assert.equal(isSameAppOrigin('https://127.0.0.1:43724/', target), false);
  assert.equal(isSameAppOrigin('http://user:pass@127.0.0.1:43724/', target), false);
});

test('only exact audio-only requests from the app origin are eligible', () => {
  assert.equal(isAudioOnlyPermission('media', target, target, ['audio']), true);
  assert.equal(isAudioOnlyPermission('media', target, target, ['video']), false);
  assert.equal(isAudioOnlyPermission('media', target, target, ['audio', 'video']), false);
  assert.equal(isAudioOnlyPermission('media', target, target, []), false);
  assert.equal(isAudioOnlyPermission('geolocation', target, target, ['audio']), false);
  assert.equal(isAudioOnlyPermission('media', 'https://example.com', target, ['audio']), false);
});

test('permission checks also fail closed for camera and wrong origins', () => {
  assert.equal(isAudioOnlyCheck('media', target, target, 'audio'), true);
  assert.equal(isAudioOnlyCheck('media', target, target, 'video'), false);
  assert.equal(isAudioOnlyCheck('media', 'https://example.com', target, 'audio'), false);
});

test('microphone requires explicit approval plus a live short arm window', () => {
  assert.equal(permissionMayUseMicrophone({ approved: false, armedUntil: 5_000, now: 1_000 }), false);
  assert.equal(permissionMayUseMicrophone({ approved: true, armedUntil: 999, now: 1_000 }), false);
  assert.equal(permissionMayUseMicrophone({ approved: true, armedUntil: 1_000, now: 1_000 }), true);
  assert.equal(permissionMayUseMicrophone({ approved: true, armedUntil: 5_000, now: 1_000 }), true);
});

test('local-voice IPC requires the live main frame, exact webContents, origin, and lifecycle', () => {
  function candidate({ frameUrl = `${target}talk`, contentsUrl = target, destroyed = false } = {}) {
    const mainFrame = { url: frameUrl };
    const expectedWebContents = {
      mainFrame,
      getURL: () => contentsUrl,
      isDestroyed: () => destroyed,
    };
    return { event: { sender: expectedWebContents, senderFrame: mainFrame }, expectedWebContents };
  }
  const allowed = candidate();
  const trusted = (fixture = allowed, lifecycleActive = true) => isTrustedIpcEvent({
    ...fixture,
    targetUrl: target,
    lifecycleActive,
  });

  assert.equal(trusted(), true);
  assert.equal(trusted(allowed, false), false);
  assert.equal(trusted({ ...allowed, event: { ...allowed.event, sender: {} } }), false);
  assert.equal(trusted({ ...allowed, event: { ...allowed.event, senderFrame: { url: `${target}child` } } }), false);
  assert.equal(trusted(candidate({ frameUrl: 'http://localhost:43724/' })), false);
  assert.equal(trusted(candidate({ frameUrl: 'https://127.0.0.1:43724/' })), false);
  assert.equal(trusted(candidate({ frameUrl: 'http://127.0.0.1:43725/' })), false);
  assert.equal(trusted(candidate({ frameUrl: 'file:///companion/index.html' })), false);
  assert.equal(trusted(candidate({ contentsUrl: 'http://localhost:43724/' })), false);
  assert.equal(trusted(candidate({ contentsUrl: 'https://127.0.0.1:43724/' })), false);
  assert.equal(trusted(candidate({ destroyed: true })), false);
});
