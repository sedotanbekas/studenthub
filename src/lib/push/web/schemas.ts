import { z } from "zod";
import { PUSH_ENDPOINT_MAX } from "./rules";

/** Skema zod Web Push (N3): status perangkat ini & bentuk PushSubscription.toJSON() dari browser. */

export const webPushStatusSchema = z
  .object({
    enabled: z.boolean().meta({ description: "Web Push aktif di server ini (kunci VAPID terpasang)." }),
    publicKey: z.string().nullable().meta({ description: "Kunci publik VAPID (applicationServerKey) bila aktif." }),
    subscribed: z.boolean().meta({ description: "Sesi ini sudah punya langganan." }),
  })
  .meta({ id: "WebPushStatus" });
export type WebPushStatusDto = z.input<typeof webPushStatusSchema>;

const b64url = (name: string, min: number, max: number) =>
  z.string().regex(/^[A-Za-z0-9_-]+$/, `${name} harus base64url.`).min(min, `${name} terlalu pendek.`).max(max, `${name} terlalu panjang.`);

export const upsertWebPushBody = z.strictObject({
  endpoint: z.url({ error: "endpoint harus URL." }).max(PUSH_ENDPOINT_MAX, "endpoint terlalu panjang."),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: b64url("keys.p256dh", 80, 100), auth: b64url("keys.auth", 16, 32) }),
});
export type UpsertWebPushBody = z.output<typeof upsertWebPushBody>;

export const webPushSubscribedSchema = z.object({ subscribed: z.boolean() }).meta({ id: "WebPushSubscribed" });
export type WebPushSubscribedDto = z.input<typeof webPushSubscribedSchema>;
