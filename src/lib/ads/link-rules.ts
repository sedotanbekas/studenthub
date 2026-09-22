import type { AdLinkType } from "@prisma/client";
import { AD_URL_MAX } from "./constants";

/**
 * Validasi tautan iklan (murni). EXTERNAL_URL: `https:` saja, tanpa userinfo, host bernama (bukan literal
 * IP / localhost / tanpa titik). DEEP_LINK: skema aplikasi yang ada di allowlist super admin
 * (PlatformSetting.deepLinkSchemes). Skema berbahaya (javascript:, data:, intent:, http:, ...) SELALU
 * ditolak walau masuk allowlist. Hasil `href` = bentuk kanonik WHATWG (host IDN menjadi punycode) dan
 * `isPunycodeHost` menandai kemungkinan homograf untuk reviewer.
 */
export type LinkRejectReason = "LENGTH" | "CHARS" | "PARSE" | "SCHEME" | "USERINFO" | "HOST";

export type LinkResult =
  | { readonly ok: true; readonly href: string; readonly host: string; readonly isPunycodeHost: boolean }
  | { readonly ok: false; readonly reason: LinkRejectReason };

const FORBIDDEN_SCHEMES: ReadonlySet<string> = new Set([
  "javascript", "data", "vbscript", "file", "blob", "intent", "about", "http", "https", "ftp", "ws", "wss",
  "filesystem", "jar", "chrome", "content", "android-app", "ms-settings",
]);

/** Skema yang tidak boleh dipakai iklan DEEP_LINK maupun masuk allowlist pengaturan. */
export const isForbiddenScheme = (scheme: string): boolean => FORBIDDEN_SCHEMES.has(scheme.toLowerCase());

/** Format skema RFC 3986 (huruf kecil). */
export const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{0,31}$/;

// Kontrol ASCII, DEL, dan spasi apa pun (\s mencakup NBSP & pemisah baris/paragraf Unicode) di dalam tautan.
const BAD_CHARS = /[\u0000-\u001F\u007F\s]/u;
const IPV4_LIKE = /^[\d.]+$/;

const reject = (reason: LinkRejectReason): LinkResult => ({ ok: false, reason });

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isNamedHost(hostname: string): boolean {
  if (hostname === "" || hostname.startsWith("[") || IPV4_LIKE.test(hostname)) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  return hostname.includes(".");
}

const isPunycode = (hostname: string): boolean => hostname.split(".").some((label) => label.startsWith("xn--"));

function checkScheme(scheme: string, linkType: AdLinkType, allowedSchemes: readonly string[]): boolean {
  if (linkType === "EXTERNAL_URL") return scheme === "https";
  if (isForbiddenScheme(scheme)) return false;
  return allowedSchemes.some((allowed) => allowed.toLowerCase() === scheme);
}

export function validateAdLink(raw: string, linkType: AdLinkType, allowedSchemes: readonly string[]): LinkResult {
  const value = raw.trim();
  if (value.length === 0 || value.length > AD_URL_MAX) return reject("LENGTH");
  if (BAD_CHARS.test(value)) return reject("CHARS");
  const url = parse(value);
  if (!url) return reject("PARSE");
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (!checkScheme(scheme, linkType, allowedSchemes)) return reject("SCHEME");
  if (url.username !== "" || url.password !== "") return reject("USERINFO");
  if (linkType === "EXTERNAL_URL" && !isNamedHost(url.hostname)) return reject("HOST");
  if (url.href.length > AD_URL_MAX) return reject("LENGTH");
  return { ok: true, href: url.href, host: url.hostname, isPunycodeHost: isPunycode(url.hostname) };
}

/** Host tautan tersimpan (untuk antrean review); null bila tidak dapat di-parse. */
export function linkHostOf(href: string): { readonly host: string; readonly isPunycodeHost: boolean } | null {
  const url = parse(href);
  return url ? { host: url.hostname, isPunycodeHost: isPunycode(url.hostname) } : null;
}
