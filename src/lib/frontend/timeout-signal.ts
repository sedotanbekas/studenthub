/**
 * AbortSignal yang batal setelah `ms` milidetik. AbortSignal.timeout belum ada di Safari < 16 (iOS 15) dan
 * Chrome < 103; memanggilnya langsung di sana melempar TypeError sinkron (alur absen jatuh ke halaman galat).
 * Cadangan: AbortController + setTimeout dengan alasan DOMException "TimeoutError" yang sama.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("Waktu tunggu habis.", "TimeoutError")), ms);
  return controller.signal;
}
