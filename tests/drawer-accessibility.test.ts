import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const appSource = readFileSync(`${root}src/App.tsx`, "utf8");

describe("drawer keyboard accessibility wiring", () => {
  it("captures the opener before moving focus into a drawer and restores it after close", () => {
    const captureEffect = appSource.indexOf("const drawerIsOpen = memoryOpen || settingsOpen || gameOpen");
    const initialFocusEffect = appSource.indexOf("const drawer = memoryOpen ? memoryDrawerRef.current");

    expect(captureEffect).toBeGreaterThan(-1);
    expect(initialFocusEffect).toBeGreaterThan(captureEffect);
    expect(appSource).toContain("useLayoutEffect");
    expect(appSource).toContain("drawerReturnFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null");
    expect(appSource).toContain("if (returnTarget?.isConnected) returnTarget.focus()");
    expect(appSource).toContain("else talkButtonRef.current?.focus()");
    expect(appSource).toContain("drawerReturnFocusRef.current = null");
    expect(appSource).not.toContain("requestAnimationFrame");
    expect(appSource).not.toContain("cancelAnimationFrame");
    expect(appSource).toContain("if (locked) unlockPasswordInputRef.current?.focus()");
    expect(appSource).toContain("else if (lockStateWasLockedRef.current) talkButtonRef.current?.focus()");
    expect(appSource).toContain("ref={unlockPasswordInputRef}");
    expect(appSource).toContain("ref={talkButtonRef}");
    expect(appSource).toMatch(/setSettingsOpen\(false\);\s*setMemoryOpen\(false\);\s*setGameOpen\(false\);\s*setLocked\(true\);/);
  });

  it("keeps Escape close and Tab containment on all three modal drawers", () => {
    expect(appSource).toContain('if (event.key === "Escape")');
    expect(appSource).toContain('if (event.key !== "Tab") return');
    expect(appSource).toContain("!focusable.includes(activeElement)");
    expect(appSource).toContain("focusable[0]?.focus()");
    expect(appSource.match(/onKeyDown=\{handleDrawerKeyDown\}/g)).toHaveLength(3);
  });

  it("does not overstate the speech-service or offline privacy boundary", () => {
    expect(appSource).toContain("Typed conversation and saved memories stay in this device profile.");
    expect(appSource).toContain("Hands-free recognition may use your browser or operating-system speech service");
    expect(appSource).toContain("Core works offline");
    expect(appSource).not.toContain("Conversation and memories stay on this device");
  });
});
