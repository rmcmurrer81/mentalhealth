'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  BUNDLED_TARGET_URL,
  HEALTH_PATH,
  assertBundledRuntimeLayout,
  resolveBundledRuntimeLayout,
  resolveRequestFile,
  securityHeaders,
  startBundledRuntime,
  stopBundledRuntime,
} = require('../desktop/runtime.cjs');

function fixtureLayout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wellbeing-runtime-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'desktop');
  const web = path.join(root, 'web');
  fs.mkdirSync(desktop);
  fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>fixture</title>');
  fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'globalThis.fixture=true;');
  return { desktop, web, layout: resolveBundledRuntimeLayout(desktop) };
}

test('runtime layout is the packaged sibling web directory', (t) => {
  const fixture = fixtureLayout(t);
  assert.equal(fixture.layout.webRoot, fixture.web);
  assert.equal(assertBundledRuntimeLayout(fixture.layout), fixture.layout);
});

test('request resolution permits files and SPA fallback but rejects traversal and backslashes', (t) => {
  const fixture = fixtureLayout(t);
  assert.equal(resolveRequestFile(fixture.web, '/'), path.join(fixture.web, 'index.html'));
  assert.equal(resolveRequestFile(fixture.web, '/assets/app.js'), path.join(fixture.web, 'assets', 'app.js'));
  assert.equal(resolveRequestFile(fixture.web, '/settings'), path.join(fixture.web, 'index.html'));
  assert.equal(resolveRequestFile(fixture.web, '/..%2f..%2fsecret.txt'), null);
  assert.equal(resolveRequestFile(fixture.web, '/assets%5capp.js'), null);
  assert.equal(resolveRequestFile(fixture.web, '/missing.js'), null);
});

test('security headers keep the renderer local and non-embeddable', () => {
  const headers = securityHeaders('text/html');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});

test('actual loopback runtime serves health and assets and closes cleanly', async (t) => {
  const fixture = fixtureLayout(t);
  const runtime = await startBundledRuntime({ layout: fixture.layout });
  t.after(() => stopBundledRuntime(runtime));
  assert.equal(runtime.targetUrl, BUNDLED_TARGET_URL);
  const health = await fetch(new URL(HEALTH_PATH, runtime.targetUrl));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: 'wellbeing-companion-local',
    workingTitle: true,
    offlineReady: true,
    externalModelConfigured: false,
  });
  const asset = await fetch(new URL('/assets/app.js', runtime.targetUrl));
  assert.equal(await asset.text(), 'globalThis.fixture=true;');
  await stopBundledRuntime(runtime);
  assert.equal(runtime.server.listening, false);
});

test('missing build fails before binding a server', () => {
  assert.throws(() => assertBundledRuntimeLayout({ webRoot: 'Z:\\missing', indexFile: 'Z:\\missing\\index.html' }), /incomplete/);
});
