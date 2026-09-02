export const RUNTIME_PUBLIC_ASSETS = [
  "manifest.webmanifest",
  "pwa/icon-180.png",
  "pwa/icon-192.png",
  "pwa/icon-512.png",
  "pwa/icon-maskable-512.png",
  "voice-previews/calm-female-approved.wav",
  "voice-previews/warm-male-approved.wav",
] as const;

export function renderServiceWorker(precacheUrls: readonly string[], buildVersion: string): string {
  const urls = JSON.stringify([...precacheUrls], null, 2);
  return `/* Generated from the exact Vite output. Do not hand-edit. */
const CACHE_PREFIX = "wellbeing-companion-shell-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(buildVersion)};
const PRECACHE_URLS = Object.freeze(${urls});
const PRECACHE_PATHS = new Set(PRECACHE_URLS.map((value) => new URL(value, self.location.origin).pathname));
const NETWORK_ONLY_PREFIXES = Object.freeze(["/api/", "/health", "/__wellbeing/"]);

async function fetchForPrecache(url) {
  const response = await fetch(new Request(url, { cache: "reload" }));
  if (!response.ok) throw new Error("Required application asset was unavailable during offline setup: " + url);
  return response;
}

async function installExactShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(PRECACHE_URLS.map(async (url) => {
    const response = await fetchForPrecache(url);
    await cache.put(url, response);
  }));
}

async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(new Request(request, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(installExactShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetchWithTimeout(request, 3500);
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match("/index.html") || await cache.match("/");
        return shell || Response.error();
      }
    })());
    return;
  }

  if (!PRECACHE_PATHS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return fetch(request);
  })());
});
`;
}
