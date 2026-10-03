/**
 * Keputusan kunci VAPID Web Push (N3) untuk `.env` deploy — murni, diuji di vapid-keys.test.ts.
 * Impor relatif (dipanggil `pnpm exec tsx` di VPS tanpa alias @/).
 */
import { generateVapidKeys, isVapidPrivateKey, isVapidPublicKey } from "../../src/lib/push/web/vapid-keys";

export type VapidKeysAction =
  | { readonly code: 0 }
  | { readonly code: 3; readonly lines: string }
  | { readonly code: 2; readonly message: string };

/**
 * 0 = pasangan sah sudah ada (tidak diubah); 3 = keduanya tidak ada / kosong -> dua baris `KEY=value` baru;
 * 2 = hanya satu / tidak sah -> berhenti (JANGAN dibuat ulang otomatis: semua langganan push browser akan putus).
 */
export function vapidKeysAction(env: { readonly VAPID_PUBLIC_KEY?: string; readonly VAPID_PRIVATE_KEY?: string }): VapidKeysAction {
  const pub = env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const priv = env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!pub && !priv) {
    const keys = generateVapidKeys();
    return { code: 3, lines: `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}` };
  }
  if (!pub || !priv) return { code: 2, message: "hanya satu dari VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY yang terisi" };
  if (!isVapidPublicKey(pub) || !isVapidPrivateKey(priv)) return { code: 2, message: "kunci VAPID di .env tidak sah" };
  return { code: 0 };
}
