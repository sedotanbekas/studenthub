import { isIP } from "node:net";

/**
 * IP klien HANYA dari header `X-Real-IP` yang di-set nginx dengan `$remote_addr` (menimpa nilai
 * kiriman klien; app bind 127.0.0.1 sehingga tidak bisa diakses tanpa nginx). `X-Forwarded-For`
 * dan `Forwarded` diabaikan sepenuhnya karena bisa dipalsukan klien (celah lims: rotasi XFF
 * palsu melewati limiter login).
 */
const MAX_IP_LENGTH = 64;
const UNKNOWN_KEY = "unknown";
const IPV6_HEXTETS = 8;

export function clientIp(req: Request): string | null {
  const raw = req.headers.get("x-real-ip");
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_IP_LENGTH) return null;
  return isIP(value) === 0 ? null : value;
}

/** Mengubah akhiran IPv4 bertitik (mis. `::ffff:1.2.3.4`) menjadi dua hextet heksadesimal. */
function embeddedIpv4ToHex(ip: string): string {
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes(".")) return ip;
  const [a = 0, b = 0, c = 0, d = 0] = tail.split(".").map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
}

/** Mengembangkan IPv6 tervalidasi menjadi 8 hextet numerik (zona `%eth0` dibuang). */
function expandIpv6(ip: string): readonly number[] {
  const withoutZone = ip.split("%")[0] ?? ip;
  const text = embeddedIpv4ToHex(withoutZone.toLowerCase());
  const [head = "", tail] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = tail === undefined ? [] : Array<string>(IPV6_HEXTETS - left.length - right.length).fill("0");
  return [...left, ...zeros, ...right].map((group) => Number.parseInt(group, 16));
}

function isIpv4Mapped(hextets: readonly number[]): boolean {
  return hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
}

function hextetsToIpv4(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

/**
 * Key limiter untuk IP: IPv4 apa adanya; IPv4-mapped IPv6 → IPv4; IPv6 lain → prefiks /64
 * (`2001:db8:1:2::/64`) karena satu pelanggan biasanya memegang seluruh /64 dan bisa merotasi
 * alamat di dalamnya. `null`/tidak valid → `"unknown"`.
 */
export function rateLimitKeyForIp(ip: string | null): string {
  if (ip === null) return UNKNOWN_KEY;
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return UNKNOWN_KEY;
  const hextets = expandIpv6(ip);
  if (isIpv4Mapped(hextets)) return hextetsToIpv4(hextets[6] ?? 0, hextets[7] ?? 0);
  const prefix = hextets.slice(0, 4).map((h) => h.toString(16));
  return `${prefix.join(":")}::/64`;
}
