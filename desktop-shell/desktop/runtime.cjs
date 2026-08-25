'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const BUNDLED_RUNTIME_HOST = '127.0.0.1';
const BUNDLED_RUNTIME_PORT = 43724;
const BUNDLED_TARGET_URL = `http://${BUNDLED_RUNTIME_HOST}:${BUNDLED_RUNTIME_PORT}/`;
const HEALTH_PATH = '/.well-known/companion-health';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp',
});

function resolveBundledRuntimeLayout(appDesktopDir = __dirname) {
  const webRoot = path.resolve(appDesktopDir, '..', 'web');
  return Object.freeze({ webRoot, indexFile: path.join(webRoot, 'index.html') });
}

function assertBundledRuntimeLayout(layout) {
  const root = fs.statSync(layout.webRoot, { throwIfNoEntry: false });
  const index = fs.statSync(layout.indexFile, { throwIfNoEntry: false });
  if (!root?.isDirectory() || !index?.isFile()) {
    throw new Error('The bundled wellbeing-companion web build is incomplete.');
  }
  return layout;
}

function securityHeaders(contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    'Content-Type': contentType,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function resolveRequestFile(webRoot, requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, BUNDLED_TARGET_URL).pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  const normalized = path.posix.normalize(pathname);
  if (!normalized.startsWith('/') || normalized.includes('/../')) return null;
  const relative = normalized === '/' ? 'index.html' : normalized.slice(1);
  const candidate = path.resolve(webRoot, ...relative.split('/'));
  const rootPrefix = `${path.resolve(webRoot)}${path.sep}`;
  if (!candidate.startsWith(rootPrefix)) return null;
  const stat = fs.statSync(candidate, { throwIfNoEntry: false });
  if (stat?.isFile()) return candidate;
  if (!path.extname(relative)) return path.join(webRoot, 'index.html');
  return null;
}

function createRequestHandler(webRoot) {
  return (request, response) => {
    if (request.url === HEALTH_PATH) {
      const body = Buffer.from(JSON.stringify({
        ok: true,
        service: 'wellbeing-companion-local',
        workingTitle: true,
        offlineReady: true,
        externalModelConfigured: false,
      }));
      response.writeHead(200, {
        ...securityHeaders('application/json; charset=utf-8'),
        'Content-Length': body.length,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(405, securityHeaders('text/plain; charset=utf-8'));
      response.end('Method not allowed');
      return;
    }
    const filePath = resolveRequestFile(webRoot, request.url ?? '/');
    if (!filePath) {
      response.writeHead(404, securityHeaders('text/plain; charset=utf-8'));
      response.end('Not found');
      return;
    }
    try {
      const bytes = fs.readFileSync(filePath);
      response.writeHead(200, {
        ...securityHeaders(CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'),
        'Content-Length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(500, securityHeaders('text/plain; charset=utf-8'));
      response.end('Local runtime error');
    }
  };
}

async function startBundledRuntime(options = {}) {
  const layout = assertBundledRuntimeLayout(
    options.layout ?? resolveBundledRuntimeLayout(options.appDesktopDir),
  );
  const server = http.createServer(createRequestHandler(layout.webRoot));
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(BUNDLED_RUNTIME_PORT, BUNDLED_RUNTIME_HOST, () => {
      server.off('error', onError);
      resolve();
    });
  }).catch((error) => {
    server.close();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The private local companion runtime could not bind ${BUNDLED_TARGET_URL}: ${detail}`);
  });
  return Object.freeze({ server, layout, targetUrl: BUNDLED_TARGET_URL });
}

async function stopBundledRuntime(runtime) {
  if (!runtime?.server?.listening) return;
  await new Promise((resolve, reject) => runtime.server.close((error) => (error ? reject(error) : resolve())));
}

module.exports = {
  BUNDLED_RUNTIME_HOST,
  BUNDLED_RUNTIME_PORT,
  BUNDLED_TARGET_URL,
  HEALTH_PATH,
  assertBundledRuntimeLayout,
  createRequestHandler,
  resolveBundledRuntimeLayout,
  resolveRequestFile,
  securityHeaders,
  startBundledRuntime,
  stopBundledRuntime,
};
