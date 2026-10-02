/**
 * Aturan murni perkiraan lokasi dari IP (tanpa I/O). Sumber data: DB-IP Lite bulanan (CC BY 4.0, wajib
 * atribusi "IP Geolocation by DB-IP" di halaman yang menampilkan hasilnya). Format MMDB kompatibel GeoLite2:
 * kota `city.names.en`, provinsi `subdivisions[0].names.en`, negara `country.iso_code`; ASN
 * `autonomous_system_number` + `autonomous_system_organization`. Lokasi IP hanya perkiraan (IP seluler
 * sering terbaca kota gerbang operator, mis. Jakarta) — ISP justru pembeda yang lebih andal.
 */
export type GeoKind = "city" | "asn";

export interface GeoInfo {
  readonly city: string | null;
  readonly region: string | null;
  readonly countryCode: string | null;
  readonly asn: number | null;
  readonly isp: string | null;
}

/** Panjang kolom LoginEvent (prisma/schema/auth.prisma). */
const MAX_PLACE = 100;
const MAX_ISP = 150;
const COUNTRY_CODE = /^[A-Z]{2}$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const DBIP_BASE = "https://download.db-ip.com/free";
const DBIP_TYPES: Readonly<Record<GeoKind, string>> = { city: "DBIP-City-Lite", asn: "DBIP-ASN-Lite" };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/** `{ names: { en } }` -> nama Inggris. */
const englishName = (value: unknown): string | null => text(asRecord(asRecord(value)?.names)?.en, MAX_PLACE);

function countryCodeOf(city: Record<string, unknown> | null): string | null {
  const code = asRecord(city?.country)?.iso_code;
  return typeof code === "string" && COUNTRY_CODE.test(code) ? code : null;
}

function asnOf(asn: Record<string, unknown> | null): number | null {
  const value = asn?.autonomous_system_number;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** Gabungkan catatan kota & ASN; tanpa data sama sekali (IP privat/tak dikenal) -> null. */
export function toGeoInfo(cityRecord: unknown, asnRecord: unknown): GeoInfo | null {
  const city = asRecord(cityRecord);
  const asn = asRecord(asnRecord);
  const subdivisions = Array.isArray(city?.subdivisions) ? city.subdivisions : [];
  const info: GeoInfo = {
    city: englishName(city?.city),
    region: englishName(subdivisions[0]),
    countryCode: countryCodeOf(city),
    asn: asnOf(asn),
    isp: text(asn?.autonomous_system_organization, MAX_ISP),
  };
  return Object.values(info).every((value) => value === null) ? null : info;
}

const regionNames = new Intl.DisplayNames(["id"], { type: "region" });

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Kota, Provinsi, Negara" (nama negara Bahasa Indonesia), bagian kosong/berulang dilewati. */
export function locationSummary(place: Pick<GeoInfo, "city" | "region" | "countryCode">): string | null {
  const parts = [place.city, place.region, countryName(place.countryCode)].filter((part): part is string => part !== null);
  const unique = parts.filter((part, index) => parts.findIndex((other) => other.toLowerCase() === part.toLowerCase()) === index);
  return unique.length === 0 ? null : unique.join(", ");
}

/** "Nama ISP (AS123)". */
export function ispSummary(isp: string | null, asn: number | null): string | null {
  const as = asn === null ? null : `AS${asn}`;
  if (isp && as) return `${isp} (${as})`;
  return isp ?? as;
}

/** Bulan rilis DB-IP (UTC) "YYYY-MM". */
export function dbipMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Bulan sebelumnya (rilis bulan berjalan bisa belum terbit di awal bulan). */
export function previousDbipMonth(month: string): string {
  const match = MONTH.exec(month);
  if (!match) throw new Error(`Bulan DB-IP tidak valid: ${month}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 2, 1));
  return dbipMonth(date);
}

export function dbipUrl(kind: GeoKind, month: string): string {
  return `${DBIP_BASE}/dbip-${kind}-lite-${month}.mmdb.gz`;
}

/** Metadata `databaseType` berkas MMDB cocok dengan jenis yang diharapkan. */
export function isDbipDatabaseType(kind: GeoKind, databaseType: string): boolean {
  return databaseType.startsWith(DBIP_TYPES[kind]);
}
