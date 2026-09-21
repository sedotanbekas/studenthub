/**
 * Waktu tick cron terakhir untuk /api/health. Disimpan di globalThis (bukan variabel modul)
 * agar tetap satu nilai walau modul ini dimuat lebih dari sekali oleh bundler antar-route.
 */
type HeartbeatGlobal = { __studenthubLastTickAt?: number };
const store = globalThis as unknown as HeartbeatGlobal;

export function recordTick(at: Date): void {
  store.__studenthubLastTickAt = at.getTime();
}

export function getLastTickAt(): Date | null {
  const epoch = store.__studenthubLastTickAt;
  return epoch === undefined ? null : new Date(epoch);
}
