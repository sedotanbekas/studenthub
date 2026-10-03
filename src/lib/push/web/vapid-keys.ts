import { generateKeyPairSync } from "node:crypto";

/**
 * Kunci VAPID Web Push (N3): pasangan ECDSA P-256. Publik = base64url titik tak terkompresi (0x04‖x‖y, 65 byte),
 * privat = base64url skalar d (32 byte) — format yang dipakai pustaka web-push & PushManager.subscribe.
 */
const B64URL = /^[A-Za-z0-9_-]+$/;

function decode(value: string): Buffer | null {
  return B64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

export function isVapidPublicKey(value: string): boolean {
  const bytes = decode(value);
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04;
}

export function isVapidPrivateKey(value: string): boolean {
  return decode(value)?.length === 32;
}

export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  if (!jwk.x || !jwk.y || !jwk.d) throw new Error("Gagal membuat kunci VAPID");
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}
