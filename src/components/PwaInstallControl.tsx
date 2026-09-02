import { useEffect, useState } from "react";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<InstallChoice>;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

function standaloneDisplay(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PwaInstallControl({ compact = false }: { compact?: boolean }) {
  const [standalone, setStandalone] = useState(standaloneDisplay);
  const [promptAvailable, setPromptAvailable] = useState(Boolean(deferredInstallPrompt));
  const [prompting, setPrompting] = useState(false);
  const [offlineReady, setOfflineReady] = useState(() => Boolean(navigator.serviceWorker?.controller));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (window.wellbeingDesktop) return;
    const displayQuery = window.matchMedia?.("(display-mode: standalone)");
    const onDisplayChange = () => setStandalone(standaloneDisplay());
    const onBeforeInstall = (rawEvent: Event) => {
      const event = rawEvent as BeforeInstallPromptEvent;
      event.preventDefault();
      deferredInstallPrompt = event;
      setPromptAvailable(true);
      setNotice("Ready to install in its own app window.");
    };
    const onInstalled = () => {
      deferredInstallPrompt = null;
      setPromptAvailable(false);
      setStandalone(true);
      setNotice("Installed. You can now open the companion from your apps.");
    };
    const onOfflineReady = () => {
      setOfflineReady(true);
      setNotice((current) => current || "Offline app files are ready on this device.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("wellbeing:pwa-offline-ready", onOfflineReady);
    displayQuery?.addEventListener?.("change", onDisplayChange);
    void navigator.serviceWorker?.ready.then(onOfflineReady);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("wellbeing:pwa-offline-ready", onOfflineReady);
      displayQuery?.removeEventListener?.("change", onDisplayChange);
    };
  }, []);

  if (window.wellbeingDesktop) return null;

  const install = async () => {
    if (standalone) {
      setNotice(offlineReady
        ? "This companion is installed and its app shell is ready offline."
        : "This companion is already open as an installed app.");
      return;
    }
    const prompt = deferredInstallPrompt;
    if (!prompt) {
      setNotice("Use your browser menu’s Install app or Add to Home Screen command. The first online visit must finish before offline use.");
      return;
    }

    setPrompting(true);
    setNotice("Opening your browser’s install confirmation…");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredInstallPrompt = null;
      setPromptAvailable(false);
      setNotice(choice.outcome === "accepted"
        ? "Install accepted. Your browser will finish adding the app."
        : "Install cancelled. You can choose Install app again later.");
    } catch {
      setNotice("The browser could not open its install confirmation. Use the browser menu’s Install app command instead.");
    } finally {
      setPrompting(false);
    }
  };

  const state = standalone ? "installed" : promptAvailable ? "available" : "manual";
  return (
    <div className={`pwa-install-control${compact ? " compact" : ""}`} data-install-state={state}>
      <button
        type="button"
        className={standalone ? "is-installed" : promptAvailable ? "is-available" : ""}
        disabled={prompting}
        onClick={() => void install()}
        aria-describedby={notice ? `pwa-install-notice-${compact ? "compact" : "full"}` : undefined}
        title={standalone ? "Installed app" : "Install in its own app window"}
      >
        <span aria-hidden="true">{standalone ? "✓" : "⇩"}</span>
        <small>{prompting ? "Wait" : standalone ? "Installed" : "Install"}</small>
      </button>
      {notice && <span id={`pwa-install-notice-${compact ? "compact" : "full"}`} className="pwa-install-notice" role="status">{notice}</span>}
    </div>
  );
}
