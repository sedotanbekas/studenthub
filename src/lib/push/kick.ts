/**
 * Pemicu pengiriman push setelah respons terkirim (notify -> ctx.defer(kickPushDispatch)). Dispatcher
 * didaftarkan saat modul src/lib/jobs/push-dispatch.ts dimuat (tick pertama, atau impor saat boot);
 * sebelum terdaftar kick tidak melakukan apa pun dan notifikasi PENDING dikirim oleh tick cron.
 * Disimpan di globalThis (bukan variabel modul): bundler dapat memuat modul ini lebih dari sekali
 * antar-route, sedangkan pendaftaran dari route tick harus terlihat oleh route domain mana pun.
 * Sengaja tanpa impor: notify.ts mengimpor berkas ini dari dalam transaksi bisnis mana pun.
 */
type KickGlobal = { __studenthubPushDispatcher?: () => Promise<void> };
const store = globalThis as unknown as KickGlobal;

export function registerPushDispatcher(run: () => Promise<void>): void {
  store.__studenthubPushDispatcher = run;
}

export function kickPushDispatch(): Promise<void> {
  const dispatcher = store.__studenthubPushDispatcher;
  return dispatcher ? dispatcher() : Promise.resolve();
}
