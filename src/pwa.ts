export const WELLBEING_SERVICE_WORKER_PATH = "/sw.js";

export function canRegisterWellbeingPwa(): boolean {
  return import.meta.env.PROD
    && typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && !window.wellbeingDesktop;
}

export async function registerWellbeingPwa(): Promise<ServiceWorkerRegistration | null> {
  if (!canRegisterWellbeingPwa()) return null;

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register(WELLBEING_SERVICE_WORKER_PATH, {
        scope: "/",
        updateViaCache: "none",
      });
      void navigator.serviceWorker.ready.then(() => {
        window.dispatchEvent(new CustomEvent("wellbeing:pwa-offline-ready"));
      });
      return registration;
    } catch (error) {
      console.warn("Wellbeing Companion offline support could not be enabled.", error);
      return null;
    }
  };

  if (document.readyState === "complete") return register();
  return new Promise((resolve) => {
    window.addEventListener("load", () => void register().then(resolve), { once: true });
  });
}
