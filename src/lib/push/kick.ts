/**
 * Pemicu pengiriman push setelah respons terkirim. Implementasi dispatcher Expo menyusul di P3;
 * sampai itu notifikasi PENDING tetap tersimpan di inbox dan dikirim oleh tick cron.
 */
let dispatcher: (() => Promise<void>) | null = null;

export function registerPushDispatcher(run: () => Promise<void>): void {
  dispatcher = run;
}

export function kickPushDispatch(): Promise<void> {
  return dispatcher ? dispatcher() : Promise.resolve();
}
