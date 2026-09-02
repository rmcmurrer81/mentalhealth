import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = readFileSync(`${root}src/App.tsx`, "utf8");
const styles = readFileSync(`${root}src/styles.css`, "utf8");
const bridgeTypes = readFileSync(`${root}src/lib/local-model.ts`, "utf8");

describe("native work-beside-me presentation", () => {
  it("keeps compact mode character-and-chat first with unobtrusive icon controls", () => {
    expect(app).toContain('data-window-mode={characterOnlyMode ? "character" : "compact"}');
    expect(app).toContain('className="compact-character-stage"');
    expect(app).toContain('className="compact-conversation"');
    expect(app).toContain('className="compact-toolbar"');
    expect(app).toContain('const initialWindowLayoutRef = useRef(requestedInitialWindowLayout())');
    expect(app).toContain('useState(initialWindowLayoutRef.current !== "full")');
    expect(app).toContain('const [alwaysOnTop, setAlwaysOnTop] = useState(initialWindowLayoutRef.current !== "full")');
    expect(app).toContain('setAlwaysOnTop(mode !== "full")');
    expect(app).toContain("<ReactiveCompanionOrb listening={listening}");
    expect(app).toContain('aria-label={characterOnlyMode ? "Orb-only corner companion"');
    expect(styles).toMatch(/\.compact-companion-shell\s*\{[^}]*grid-template-rows:\s*minmax\(330px, 1fr\) auto 58px/);
    expect(styles).toMatch(/\.compact-character-stage \.companion-orb-stage\s*\{[^}]*transform:translateY\(-32px\)/);
    expect(styles).toMatch(/\.character-only \.compact-character-stage \.companion-orb-stage\s*\{[^}]*transform:none/);
    expect(styles).toMatch(/\.compact-toolbar small\s*\{\s*display:\s*none/);
    expect(styles).toMatch(/\.compact-toolbar[^}]*opacity:\s*\.66/);
    expect(styles).not.toMatch(/\.compact-character-stage[^}]*background:\s*(?:#fff|white)/i);
  });

  it("keeps the complete compact transcript readable and follows the newest turn", () => {
    expect(app).toContain('aria-label="Full conversation transcript"');
    expect(app).toContain('ref={compactTurnsRef}');
    expect(app).toContain('profile.turns.map((turn, index)');
    expect(app).toContain('ref={index === profile.turns.length - 1 ? latestCompactTurnRef : undefined}');
    expect(app).toContain('revealLatestTurnFromItsBeginning(compactTurnsRef.current, latestCompactTurnRef.current)');
    expect(app).toContain('latestTurn.offsetTop - transcript.offsetTop');
    expect(app).not.toContain('turns?.scrollTo({ top: turns.scrollHeight');
    expect(styles).toMatch(/\.compact-turns\s*\{[^}]*overflow-y:\s*auto/);
    expect(styles).toMatch(/\.compact-turns\s*\{[^}]*scroll-padding-block:\s*1px 8px/);
    expect(styles).toMatch(/\.compact-turn p\s*\{[^}]*white-space:\s*pre-wrap/);
    expect(styles).toMatch(/\.compact-turn p\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(styles).toMatch(/\.compact-turn p\s*\{[^}]*max-height:\s*none/);
    expect(styles).toMatch(/\.compact-turn p\s*\{[^}]*overflow:\s*visible/);
    expect(styles).toMatch(/\.compact-turn p\s*\{[^}]*text-overflow:\s*clip/);
    expect(styles).not.toMatch(/\.compact-turn p\s*\{[^}]*-webkit-line-clamp/);
    expect(styles).toMatch(/\.compact-turn p,\s*\n\.compact-composer textarea\s*\{[^}]*font-size:\s*\.875rem/);
    expect(styles).toMatch(/Readability floor:[\s\S]*\.compact-status,[\s\S]*font-size:\s*\.75rem/);
  });

  it("reveals activities, memory, or settings in place without opening the dashboard", () => {
    expect(app).toContain('type CompactPanel = "activities" | "memory" | "settings"');
    expect(app).toContain('compactPanel === "activities"');
    expect(app).toContain('compactPanel === "memory"');
    expect(app).toContain('compactPanel === "settings"');
    expect(app).toContain('onClick={() => toggleCompactPanel("activities")}');
    expect(app).toContain('onClick={() => toggleCompactPanel("memory")}');
    expect(app).toContain('onClick={() => toggleCompactPanel("settings")}');
    expect(app).not.toContain('onClick={() => void openFullPanel("play")} aria-label="Open activities and play"');
    expect(styles).toMatch(/\.compact-panel\s*\{[^}]*max-height:\s*242px/);
    expect(styles).toMatch(/\.compact-activity-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });

  it("offers a smaller character-only mode that reveals chat on demand", () => {
    expect(app).toContain('data-window-mode={characterOnlyMode ? "character" : "compact"}');
    expect(app).toContain('if (characterOnlyMode) setCompactChatVisible(true)');
    expect(app).toContain('!characterOnlyMode || compactChatVisible || listening || speaking');
    expect(app).toContain('changeWindowMode(characterOnlyMode ? "compact" : "character")');
    expect(styles).toMatch(/\.compact-companion-shell\.character-only\s*\{[^}]*grid-template-rows:\s*1fr/);
    expect(styles).toMatch(/\.character-only \.compact-toolbar[^}]*opacity:\s*\.08/);
    expect(styles).toMatch(/\.character-only \.compact-titlebar, \.character-only \.compact-toolbar\s*\{\s*opacity:\s*0/);
    expect(styles).toMatch(/\.character-only \.compact-conversation[^}]*position:\s*absolute/);
  });

  it("carries the bold dimensional palette into settings, activities, and urgent support", () => {
    expect(styles).toMatch(/\.drawer\s*\{[^}]*radial-gradient[^}]*linear-gradient\(158deg, #21115c/);
    expect(styles).toMatch(/\.voice-choices label\.selected[^}]*#ffd84d/);
    expect(styles).toMatch(/\.game-card:nth-child\(3n\)[^}]*rgba\(49,222,255/);
    expect(styles).toMatch(/\.safety-corner\.attention[^}]*linear-gradient\(145deg, rgba\(114,18,86/);
    expect(styles).toMatch(/\.theme-choices label\.selected[^}]*#ffd84d/);
    expect(styles).toContain('html[data-theme="light"] .compact-companion-shell');
  });

  it("types explicit native full, compact, character, pin, and hide controls", () => {
    expect(bridgeTypes).toContain('setWindowMode?(mode: "full" | "compact" | "character")');
    expect(bridgeTypes).toContain("onWindowModeChanged?");
    expect(bridgeTypes).toContain("setAlwaysOnTop?(enabled: boolean)");
    expect(bridgeTypes).toContain("hideWindow?(): void");
    expect(app).toContain("toggleAlwaysOnTop");
    expect(app).toContain("window.wellbeingDesktop?.hideWindow?.()");
  });
});
