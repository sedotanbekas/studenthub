import { createECDH, createHash } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { previewText } from "@/lib/notifications/rules";
import { PUSH_BODY_MAX, PUSH_ERROR, PUSH_MAX_AGE_MINUTES, PUSH_TITLE_MAX } from "../constants";
import { classifyRequestError, pushLinkOf, type DeviceResult, type PushSource } from "../rules";
import { isVapidPrivateKey, isVapidPublicKey } from "./vapid-keys";

/**
 * Aturan murni Web Push (N3, keputusan pemilik 2026-10-03): mode dari env, penjaga endpoint (SSRF), tautan klik per
 * peran, TTL, payload service worker, dan klasifikasi galat kirim.
 */

export type WebPushSettings =
  | { readonly mode: "off"; readonly reason: "NO_KEYS" | "BAD_KEYS" | "BAD_SUBJECT" }
  | { readonly mode: "memory" | "vapid"; readonly publicKey: string; readonly privateKey: string; readonly subject: string };

export interface WebPushEnv {
  readonly PUSH_TRANSPORT: string;
  readonly APP_ORIGIN: string;
  readonly VAPID_PUBLIC_KEY?: string | undefined;
  readonly VAPID_PRIVATE_KEY?: string | undefined;
  readonly VAPID_SUBJECT?: string | undefined;
}

const TEST_SUBJECT = "mailto:test@studenthub.id";

/** Subjek VAPID: mailto: atau https:// bukan localhost (Safari menolak dengan BadJwtToken). */
export function isVapidSubject(subject: string): boolean {
  if (/^mailto:[^\s@]+@[^\s@]+$/.test(subject)) return true;
  try {
    const url = new URL(subject);
    return url.protocol === "https:" && !/^(localhost|127\.|\[::1\])|\.localhost$/.test(url.hostname);
  } catch {
    return false;
  }
}

/** Urutan: tanpa kunci -> mati; kunci rusak -> mati; PUSH_TRANSPORT=memory -> memori (tanpa cek subjek); subjek. */
export function webPushSettingsOf(env: WebPushEnv): WebPushSettings {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { mode: "off", reason: "NO_KEYS" };
  if (!isVapidPublicKey(publicKey) || !isVapidPrivateKey(privateKey)) return { mode: "off", reason: "BAD_KEYS" };
  if (env.PUSH_TRANSPORT === "memory") return { mode: "memory", publicKey, privateKey, subject: env.VAPID_SUBJECT ?? TEST_SUBJECT };
  const subject = env.VAPID_SUBJECT ?? env.APP_ORIGIN;
  if (!isVapidSubject(subject)) return { mode: "off", reason: "BAD_SUBJECT" };
  return { mode: "vapid", publicKey, privateKey, subject };
}

// ----------------------------------------------------------------------------- endpoint & kunci langganan

export const PUSH_ENDPOINT_MAX = 2048;
/** Push service yang dikenal (Chrome/Android, Safari/iOS, Firefox, Edge). Selain ini ditolak (penjaga SSRF). */
const PUSH_HOSTS: readonly RegExp[] = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)+push\.apple\.com$/, /^([a-z0-9-]+\.)+push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)+notify\.windows\.com$/];
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

export function checkPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > PUSH_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || IP_LITERAL.test(url.hostname)) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}

export const endpointHashOf = (endpoint: string): string => createHash("sha256").update(endpoint).digest("hex");

const B64URL = /^[A-Za-z0-9_-]+$/;

/** p256dh harus titik P-256 yang sah (bukan sekadar 65 byte): titik rusak membuat enkripsi gagal di setiap kirim. */
export function isValidSubscriptionKeys(keys: { readonly p256dh: string; readonly auth: string }): boolean {
  if (!B64URL.test(keys.p256dh) || !B64URL.test(keys.auth)) return false;
  if (Buffer.from(keys.auth, "base64url").length !== 16) return false;
  const point = Buffer.from(keys.p256dh, "base64url");
  if (point.length !== 65 || point[0] !== 0x04) return false;
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(point);
    return true;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------- tautan klik per peran

type SectionMap = Readonly<Record<string, string>>;

/**
 * layar notifikasi (data.screen) -> bagian hub per peran. Hub hanya merutekan /hub/<bagian>; detail dibuka dari
 * kartu notifikasi. Layar yang tidak dipetakan -> /hub/notifications (kartu notifikasi memuat tombolnya, N4).
 */
export const WEB_PUSH_SECTIONS: Readonly<Record<UserRole, SectionMap>> = {
  STUDENT: {
    invoice: "my-billing", invoices: "my-billing", "leave-request": "my-leave", "attendance-alpha": "my-leave",
    "report-card": "my-reports", attendance: "my-attendance", "check-in": "my-attendance",
  },
  SCHOOL_ADMIN: {
    "payment-review": "billing", invoice: "billing", invoices: "billing", "leave-request": "attendance", "leave-review": "attendance",
    attendance: "attendance", "attendance-day": "attendance", student: "students", "school-settings": "school-settings",
  },
  SUPER_ADMIN: { sponsor: "sponsors", "ad-review": "ad-review", "topup-review": "topups", school: "schools", "school-settings": "schools" },
  SPONSOR: { ad: "campaigns", topup: "balance", sponsor: "balance" },
};

/** Layar yang SENGAJA membuka kotak masuk (pengumuman & notifikasi tanpa layar khusus). */
export const WEB_PUSH_INBOX_SCREENS: readonly string[] = ["announcement", "notification"];

export function webPathOf(role: UserRole, screen: string, notificationId: string): string {
  const notif = `notif=${encodeURIComponent(notificationId)}`;
  const section = WEB_PUSH_SECTIONS[role][screen];
  if (!section) return `/hub/notifications?${notif}`;
  // Pengingat absen (N5): langsung membuka alur absen.
  if (role === "STUDENT" && screen === "check-in") return `/hub/my-attendance?absen=1&${notif}`;
  return `/hub/${section}?${notif}`;
}

// ----------------------------------------------------------------------------- TTL & payload

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = PUSH_MAX_AGE_MINUTES * 60;

/**
 * Sisa jendela 60 menit (selaras EXPIRED), minimal 60 detik. Dengan `expiresAt` (pengingat absen, N5) TTL tidak
 * pernah melewati waktu itu (tanpa lantai 60 detik; minimal 1) — layanan push membuang pesan setelahnya.
 */
export function webPushTtlSeconds(createdAt: Date, now: Date, expiresAt?: Date | null): number {
  const remaining = Math.max(MIN_TTL_SECONDS, MAX_TTL_SECONDS - Math.floor((now.getTime() - createdAt.getTime()) / 1000));
  if (!expiresAt) return Math.min(MAX_TTL_SECONDS, remaining);
  return Math.max(1, Math.min(MAX_TTL_SECONDS, remaining, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)));
}

export interface WebPushPayload {
  readonly notificationId: string;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly tag: string;
  /** Jumlah belum dibaca untuk badge ikon aplikasi; null = jangan ubah. */
  readonly badge: number | null;
  readonly icon: string;
  readonly badgeIcon: string;
}

export const WEB_PUSH_ICON = "/brand/app-192.png";
export const WEB_PUSH_BADGE_ICON = "/brand/badge-96.png";

/** Ikon notifikasi: bawaan, atau dari logo unggahan Pengaturan aplikasi (src/lib/app-settings/icon-rules.ts). */
export interface WebPushIcons { readonly icon: string; readonly badgeIcon: string }
export const DEFAULT_WEB_PUSH_ICONS: WebPushIcons = { icon: WEB_PUSH_ICON, badgeIcon: WEB_PUSH_BADGE_ICON };

export function buildWebPushPayload(row: PushSource, role: UserRole, unread: number | null, icons: WebPushIcons = DEFAULT_WEB_PUSH_ICONS): WebPushPayload {
  const link = pushLinkOf(row.data, row.id);
  return {
    notificationId: row.id,
    title: previewText(row.title, PUSH_TITLE_MAX),
    body: previewText(row.body, PUSH_BODY_MAX),
    url: webPathOf(role, link.screen, row.id),
    tag: `n-${row.id}`,
    badge: unread,
    icon: icons.icon,
    badgeIcon: icons.badgeIcon,
  };
}

// ----------------------------------------------------------------------------- klasifikasi galat

/** Batas waktu keras satu kiriman (opsi `timeout` web-push hanya batas diam soket). */
export const WEB_PUSH_TIMEOUT_CODE = "WEB_PUSH_TIMEOUT";
const NETWORK_CODES: ReadonlySet<string> = new Set([
  WEB_PUSH_TIMEOUT_CODE, "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ECONNABORTED", "EHOSTUNREACH", "ENETUNREACH", "ESOCKETTIMEDOUT",
]);

/**
 * 404/410 -> langganan mati (hapus); kode HTTP lain -> aturan request Expo (429/5xx coba lagi, 4xx gagal); tanpa kode
 * HTTP: galat jaringan -> coba lagi, selain itu (mis. enkripsi gagal) -> gagal permanen agar tidak diulang 4x.
 */
export function classifyWebPushError(error: unknown): Exclude<DeviceResult, { kind: "ok" }> {
  const { statusCode, code } = (typeof error === "object" && error !== null ? error : {}) as { statusCode?: unknown; code?: unknown };
  if (statusCode === 404 || statusCode === 410) return { kind: "unregistered" };
  if (typeof statusCode === "number") return classifyRequestError(error);
  if (typeof code === "string" && (NETWORK_CODES.has(code) || code.startsWith("UND_ERR"))) return { kind: "retry", error: PUSH_ERROR.NETWORK_ERROR };
  return { kind: "fail", error: "WEB_PUSH_REJECTED" };
}
