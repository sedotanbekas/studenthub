/**
 * Halaman masuk dirender server, jadi tombol "Coba tanpa login" sudah terlihat SEBELUM JS aktif. Ketukan
 * pada saat itu dicatat oleh skrip sebaris kecil (app/hub/layout.tsx) lalu dijalankan Login setelah
 * hidrasi — ketukan pengguna di HP lambat tidak hilang.
 */
export const EARLY_DEMO = { attribute: "data-demo-persona", key: "__studenthubEarlyDemo", hydrated: "__studenthubHydrated" } as const;

interface ClickTarget { closest?: (selector: string) => { getAttribute(name: string): string | null } | null }
interface CaptureDocument { addEventListener(type: string, listener: (event: { target: unknown }) => void, capture: boolean): void }

/**
 * Pencatat klik fase capture. WAJIB mandiri (tanpa impor/konstanta modul) karena diserialisasi lewat
 * toString() menjadi <script> sebaris.
 */
export function earlyDemoCapture(doc: CaptureDocument, store: Record<string, unknown>, attribute: string, key: string, hydrated: string): void {
  doc.addEventListener("click", event => {
    if (store[hydrated]) return;
    const target = event.target as ClickTarget | null;
    const button = target && typeof target.closest === "function" ? target.closest("[" + attribute + "]") : null;
    if (button) store[key] = button.getAttribute(attribute);
  }, true);
}

/** Isi <script> sebaris: galat apa pun ditelan (tanpa pencatat, halaman tetap berfungsi setelah JS aktif). */
export function earlyDemoScript(): string {
  const args = [EARLY_DEMO.attribute, EARLY_DEMO.key, EARLY_DEMO.hydrated].map(v => JSON.stringify(v)).join(",");
  return `try{(${earlyDemoCapture.toString()})(document,window,${args})}catch(e){}`;
}

/** Dipanggil setelah hidrasi: tandai terhidrasi, ambil (sekali) persona yang diketuk lebih awal bila sah. */
export function takeEarlyDemo(store: Record<string, unknown>, personaKeys: readonly string[]): string | null {
  store[EARLY_DEMO.hydrated] = true;
  const key = store[EARLY_DEMO.key];
  delete store[EARLY_DEMO.key];
  return typeof key === "string" && personaKeys.includes(key) ? key : null;
}
