/**
 * Tawaran pasang Chromium (beforeinstallprompt) ditahan sejak modul dimuat: infobar bawaan tidak muncul, tombol
 * "Pasang" di hub / halaman /pasang memanggil prompt() asli. Event hanya bisa dipakai sekali; browser menawarkan
 * lagi di pemuatan berikutnya. Safari/Firefox tidak pernah mengirim event ini (state tetap "none").
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type PromptState = "none" | "ready" | "installed";
export type PromptOutcome = "accepted" | "dismissed" | "unavailable";

export interface InstallPromptStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PromptState;
  prompt(): Promise<PromptOutcome>;
}

export function createInstallPromptStore(target: EventTarget): InstallPromptStore {
  let deferred: BeforeInstallPromptEvent | null = null;
  let state: PromptState = "none";
  const listeners = new Set<() => void>();
  const set = (next: PromptState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  target.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    set("ready");
  });
  target.addEventListener("appinstalled", () => {
    deferred = null;
    set("installed");
  });
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => state,
    async prompt() {
      const event = deferred;
      if (!event) return "unavailable";
      deferred = null;
      set("none");
      try {
        await event.prompt();
        const { outcome } = await event.userChoice;
        if (outcome === "accepted") set("installed");
        return outcome;
      } catch {
        return "unavailable";
      }
    },
  };
}

const SERVER_STORE: InstallPromptStore = { subscribe: () => () => {}, getSnapshot: () => "none", prompt: async () => "unavailable" };

/** Satu penampung per tab, dipasang saat modul pertama kali dimuat di browser. */
export const installPrompt: InstallPromptStore = typeof window === "undefined" ? SERVER_STORE : createInstallPromptStore(window);
