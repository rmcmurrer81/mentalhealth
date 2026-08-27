import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { isUrgentOptionsAction, revealUrgentOptions } from "../src/lib/urgent-options";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSource = readFileSync(`${root}src/App.tsx`, "utf8");

describe("urgent-options quick action", () => {
  it("recognizes only the dedicated quick action", () => {
    expect(isUrgentOptionsAction("Open urgent options")).toBe(true);
    expect(isUrgentOptionsAction(" open urgent options. ")).toBe(true);
    expect(isUrgentOptionsAction("Tell you what is happening")).toBe(false);
  });

  it("opens, brings the panel into view, and focuses its summary", () => {
    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    const panel = {
      open: false,
      scrollIntoView,
      querySelector: vi.fn((selector: string) => selector === "summary" ? { focus } : null),
    } as unknown as HTMLDetailsElement;

    expect(revealUrgentOptions(panel)).toBe(true);
    expect(panel.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("does nothing safely before a panel is mounted", () => {
    expect(revealUrgentOptions(null)).toBe(false);
  });

  it("wires the dedicated action to the panel without sending it as chat", () => {
    const handlerStart = appSource.indexOf("function handleQuickAction(action: string)");
    const handlerEnd = appSource.indexOf("function announceGame", handlerStart);
    const handler = appSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handler).toContain("if (isUrgentOptionsAction(action))");
    expect(handler).toMatch(/revealUrgentOptions\(urgentOptionsRef\.current\);\s*return;/);
    expect(handler.indexOf("revealUrgentOptions")).toBeLessThan(handler.indexOf("void send(action)"));
    expect(appSource).toContain('onClick={() => handleQuickAction(action)}');
    expect(appSource).toContain('ref={urgentOptionsRef}');
  });
});
