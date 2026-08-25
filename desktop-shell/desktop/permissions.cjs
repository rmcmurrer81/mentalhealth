'use strict';

function normalizedOrigin(candidate) {
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isSameAppOrigin(candidate, targetUrl) {
  const candidateOrigin = normalizedOrigin(candidate);
  const targetOrigin = normalizedOrigin(targetUrl);
  return Boolean(candidateOrigin && targetOrigin && candidateOrigin === targetOrigin);
}

function isAudioOnlyPermission(permission, requestingOrigin, targetUrl, mediaTypes) {
  if (permission !== 'media' || !Array.isArray(mediaTypes)) return false;
  const uniqueTypes = [...new Set(mediaTypes)].sort();
  return uniqueTypes.length === 1
    && uniqueTypes[0] === 'audio'
    && isSameAppOrigin(requestingOrigin, targetUrl);
}

function isAudioOnlyCheck(permission, requestingOrigin, targetUrl, mediaType) {
  return permission === 'media'
    && mediaType === 'audio'
    && isSameAppOrigin(requestingOrigin, targetUrl);
}

function permissionMayUseMicrophone({ approved, armedUntil, now = Date.now() }) {
  return approved === true && Number.isFinite(armedUntil) && armedUntil >= now;
}

function isTrustedIpcEvent({ event, expectedWebContents, targetUrl, lifecycleActive }) {
  try {
    return lifecycleActive === true
      && Boolean(event?.sender && event?.senderFrame && expectedWebContents)
      && event.sender === expectedWebContents
      && event.senderFrame === expectedWebContents.mainFrame
      && typeof expectedWebContents.isDestroyed === 'function'
      && !expectedWebContents.isDestroyed()
      && isSameAppOrigin(expectedWebContents.getURL(), targetUrl)
      && isSameAppOrigin(event.senderFrame.url, targetUrl);
  } catch {
    return false;
  }
}

module.exports = {
  isAudioOnlyCheck,
  isAudioOnlyPermission,
  isSameAppOrigin,
  isTrustedIpcEvent,
  normalizedOrigin,
  permissionMayUseMicrophone,
};
