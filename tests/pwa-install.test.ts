import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderServiceWorker, RUNTIME_PUBLIC_ASSETS } from "../pwa-build";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

function pngDimensions(path: string): [number, number] {
  const image = readFileSync(resolve(root, path));
  expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

describe("installable browser application boundary", () => {
  it("publishes a scoped standalone manifest with reviewed normal and maskable icons", () => {
    const manifest = JSON.parse(source("public/manifest.webmanifest")) as {
      id: string;
      start_url: string;
      scope: string;
      display: string;
      display_override: string[];
      icons: Array<{ src: string; sizes: string; purpose: string }>;
    };

    expect(manifest).toMatchObject({
      id: "/",
      start_url: "/?layout=full&pwa=1",
      scope: "/",
      display: "standalone",
      display_override: ["standalone", "minimal-ui"],
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/pwa/icon-192.png", sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ src: "/pwa/icon-512.png", sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ src: "/pwa/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
    ]));
    expect(pngDimensions("public/pwa/icon-180.png")).toEqual([180, 180]);
    expect(pngDimensions("public/pwa/icon-192.png")).toEqual([192, 192]);
    expect(pngDimensions("public/pwa/icon-512.png")).toEqual([512, 512]);
    expect(pngDimensions("public/pwa/icon-maskable-512.png")).toEqual([512, 512]);
  });

  it("links install metadata and exposes the install control in full and compact browser layouts", () => {
    const html = source("index.html");
    const app = source("src/App.tsx");
    const control = source("src/components/PwaInstallControl.tsx");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" sizes="180x180" href="/pwa/icon-180.png"');
    expect(app.match(/<PwaInstallControl(?: compact)? \/>/g)).toEqual([
      "<PwaInstallControl compact />",
      "<PwaInstallControl />",
    ]);
    expect(control).toContain('window.addEventListener("beforeinstallprompt"');
    expect(control).toContain("Use your browser menu’s Install app or Add to Home Screen command.");
    expect(control).toContain("if (window.wellbeingDesktop) return null;");
  });

  it("registers the production worker only outside the preserved desktop host", () => {
    const bootstrap = source("src/main.tsx");
    const registration = source("src/pwa.ts");
    expect(bootstrap).toContain("registerWellbeingPwa();");
    expect(registration).toContain("import.meta.env.PROD");
    expect(registration).toContain("&& !window.wellbeingDesktop");
    expect(registration).toContain('updateViaCache: "none"');
    expect(registration).toContain('window.dispatchEvent(new CustomEvent("wellbeing:pwa-offline-ready"))');
  });

  it("renders a versioned exact-output worker that keeps dynamic routes network-only", () => {
    const exactAssets = [
      "/",
      "/index.html",
      "/assets/index-abc123.js",
      "/assets/index-def456.css",
      "/manifest.webmanifest",
    ];
    const worker = renderServiceWorker(exactAssets, "test-build-1234");
    expect(worker).toContain('const CACHE_NAME = CACHE_PREFIX + "test-build-1234"');
    for (const asset of exactAssets) expect(worker).toContain(JSON.stringify(asset));
    expect(worker).toContain('new Request(url, { cache: "reload" })');
    expect(worker).toContain("await Promise.all(PRECACHE_URLS.map");
    expect(worker).toContain('Object.freeze(["/api/", "/health", "/__wellbeing/"])');
    expect(worker).toContain('cache.match(request, { ignoreSearch: true })');
    expect(worker).toContain('cache.match("/index.html") || await cache.match("/")');
    expect(worker).toContain("name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME");
    expect(worker).not.toContain('cache.put("/index.html", response.clone())');
  });

  it("keeps every declared install asset inside the explicit production public boundary", () => {
    expect(RUNTIME_PUBLIC_ASSETS).toEqual(expect.arrayContaining([
      "manifest.webmanifest",
      "pwa/icon-180.png",
      "pwa/icon-192.png",
      "pwa/icon-512.png",
      "pwa/icon-maskable-512.png",
    ]));
  });
});
