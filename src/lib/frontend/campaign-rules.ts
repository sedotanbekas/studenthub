import { AD_MAX_DURATION_DAYS, AD_MAX_START_LEAD_DAYS, AD_TITLE_MAX, AD_TITLE_MIN, MAX_TARGETS_PER_AD } from "@/lib/ads/constants";
import { SCHEME_PATTERN, isForbiddenScheme, validateAdLink, type LinkRejectReason } from "@/lib/ads/link-rules";
import { MAX_PENDING_TOPUPS, NOTE_MAX, SENDER_BANK_MAX, SENDER_NAME_MAX, TOPUP_MAX, TOPUP_MAX_TRANSFER_AGE_DAYS } from "@/lib/sponsors/constants";
import { UPLOAD_POLICY, checkBannerMeta, type BannerReason } from "@/lib/storage/policy";
import { addDays, diffDays, parseLocalDate, wibDate } from "@/lib/time/zone";
import type { AdDto, AdLinkType, SponsorBalanceDto, SponsorDto, TargetSchool, TopUpDto } from "./ad-types";
import { niceMax } from "./chart-rules";
import { number, rupiah } from "./format";

/**
 * Aturan murni halaman sponsor "Kampanye saya" (daftar, detail, editor) dan "Saldo & top-up": filter &
 * nada status, jadwal tanggal WIB <-> ISO +07:00, validasi draf yang meniru aturan server, badan
 * POST/PATCH sesuai kontrak strict, pemetaan galat server ke field, serta simulasi mode demo.
 */

type DisplayStatus = AdDto["displayStatus"];
type AdScope = AdDto["targetScope"];
type SponsorStatus = SponsorDto["status"];

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();
const asIso = (value: string): string => new Date(value).toISOString();
const dateFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("id-ID", { ...options, timeZone: "UTC" });
const DAY_MONTH = dateFormat({ day: "numeric", month: "short" });
const DAY_MONTH_YEAR = dateFormat({ day: "numeric", month: "short", year: "numeric" });
const WIB_TIME = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

/** "12 Sep" dari tanggal lokal YYYY-MM-DD. */
export const dayMonth = (date: string): string => DAY_MONTH.format(new Date(`${date}T00:00:00Z`));
/** "12 Sep 2026" dari tanggal lokal YYYY-MM-DD. */
export const longDate = (date: string): string => DAY_MONTH_YEAR.format(new Date(`${date}T00:00:00Z`));
/** Jam WIB "11.50" dari waktu ISO. */
export const wibTime = (iso: string): string => WIB_TIME.format(new Date(iso));

// ----------------------------------------------------------------------------- daftar & status

export type CampaignFilter = "ALL" | "LIVE" | "PENDING_REVIEW" | "DRAFT" | "REJECTED" | "PAUSED" | "DONE";
export const CAMPAIGN_FILTERS: readonly { readonly value: CampaignFilter; readonly label: string }[] = [
  { value: "ALL", label: "Semua" }, { value: "LIVE", label: "Tayang" }, { value: "PENDING_REVIEW", label: "Menunggu tinjauan" },
  { value: "DRAFT", label: "Draf" }, { value: "REJECTED", label: "Ditolak" }, { value: "PAUSED", label: "Dijeda" }, { value: "DONE", label: "Selesai/Diarsipkan" },
];

export function matchesFilter(ad: { readonly displayStatus: DisplayStatus }, filter: CampaignFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "DONE") return ad.displayStatus === "ENDED" || ad.displayStatus === "ARCHIVED";
  return ad.displayStatus === filter;
}

export function filterCounts(ads: readonly { readonly displayStatus: DisplayStatus }[]): Record<CampaignFilter, number> {
  return Object.fromEntries(CAMPAIGN_FILTERS.map(f => [f.value, ads.filter(ad => matchesFilter(ad, f.value)).length])) as Record<CampaignFilter, number>;
}

export type StatusTone = "green" | "blue" | "amber" | "red" | "neutral";
const TONES: Readonly<Record<DisplayStatus, StatusTone>> = {
  LIVE: "green", SCHEDULED: "blue", PENDING_REVIEW: "amber", PAUSED: "amber", REJECTED: "red", NO_BALANCE: "red",
  SPONSOR_INACTIVE: "red", DRAFT: "neutral", ENDED: "neutral", ARCHIVED: "neutral",
};
export const statusTone = (status: DisplayStatus): StatusTone => TONES[status];

/** Penjelasan singkat status untuk detail kampanye. */
export function statusNote(ad: Pick<AdDto, "displayStatus" | "startAt">): string {
  const notes: Readonly<Record<DisplayStatus, string>> = {
    LIVE: "Sedang tayang di beranda siswa sesuai jangkauan.",
    SCHEDULED: `Sudah disetujui. Mulai tayang ${dayMonth(wibDate(new Date(ad.startAt)))}.`,
    PENDING_REVIEW: "Tim Student Hub sedang meninjau banner, tautan, dan jangkauan kampanye ini.",
    DRAFT: "Belum diajukan. Ajukan tinjauan bila kampanye sudah siap tayang.",
    REJECTED: "Belum disetujui. Perbaiki sesuai catatan peninjau, lalu ajukan ulang.",
    PAUSED: "Dijeda: tidak tayang dan tidak ada biaya sampai dilanjutkan.",
    ENDED: "Jadwal tayang sudah selesai. Perpanjang tanggal selesai untuk menayangkannya lagi.",
    NO_BALANCE: "Berhenti tayang karena saldo habis. Isi saldo untuk melanjutkan.",
    SPONSOR_INACTIVE: "Tidak tayang karena akun sponsor sedang tidak aktif.",
    ARCHIVED: "Diarsipkan. Statistiknya tetap tersimpan.",
  };
  return notes[ad.displayStatus];
}

// ----------------------------------------------------------------------------- jadwal

/** Mulai tayang: tanggal lokal pukul 00.00 WIB. */
export const toStartIso = (date: string): string => `${date}T00:00:00+07:00`;
/** Selesai tayang inklusif: hari berikutnya pukul 00.00 WIB. */
export const toEndIso = (date: string): string => `${addDays(date, 1)}T00:00:00+07:00`;
/** Hari terakhir tayang (WIB) dari endAt eksklusif. */
export const lastDayOf = (endAt: string): string => wibDate(new Date(Date.parse(endAt) - 1));
export const daysInclusive = (startDate: string, endDate: string): number => diffDays(endDate, startDate) + 1;

/** Batas isian tanggal jadwal (atribut min/max input date): tahun 4 digit. */
export const SCHEDULE_DATE_MIN = "2000-01-01";
export const SCHEDULE_DATE_MAX = "9999-12-31";
export const INVALID_DATE = "Tanggal tidak valid. Periksa tanggal mulai dan selesai (tahun 4 digit).";

/** Tanggal kalender nyata YYYY-MM-DD dalam batas isian; tahun 5 digit (bisa diketik di input date) ditolak. */
export const isScheduleDate = (value: string): boolean => parseLocalDate(value) !== null && value >= SCHEDULE_DATE_MIN && value <= SCHEDULE_DATE_MAX;

/** Tanggal diisi tetapi tidak sah -> pesan; kosong ditangani validasi "Isi tanggal". */
export const scheduleDateProblem = (startDate: string, endDate: string): string | null =>
  [startDate, endDate].some(d => d !== "" && !isScheduleDate(d)) ? INVALID_DATE : null;

/** Lama tayang inklusif; null bila tanggal kosong/tidak sah atau selesai sebelum mulai (tidak pernah melempar). */
export function scheduleDays(startDate: string, endDate: string): number | null {
  if (!isScheduleDate(startDate) || !isScheduleDate(endDate) || endDate < startDate) return null;
  return daysInclusive(startDate, endDate);
}

/** Tanggal selesai tombol durasi cepat (`days` hari termasuk hari mulai); null bila mulai tidak sah/melewati batas. */
export function quickEndDate(startDate: string, days: number): string | null {
  if (!isScheduleDate(startDate)) return null;
  const end = addDays(startDate, days - 1);
  return isScheduleDate(end) ? end : null;
}

/** Keterangan di bawah jadwal: lama & jam tayang; tanggal kosong/tidak sah -> keterangan umum (galatnya dari scheduleDateProblem). */
export function scheduleHint(startDate: string, endDate: string): string {
  const days = scheduleDays(startDate, endDate);
  if (days === null) return "Tanggal selesai ikut ditayangkan sampai pukul 23.59 WIB.";
  return `${number(days)} hari tayang: ${dayMonth(startDate)} pukul 00.00 sampai ${dayMonth(endDate)} pukul 23.59 WIB.`;
}

/** "12 Sep – 5 Nov"; tahun ditulis bila lintas tahun atau bukan tahun berjalan. */
export function scheduleRange(startAt: string, endAt: string, today: string): string {
  const start = wibDate(new Date(startAt));
  const end = lastDayOf(endAt);
  const [startYear, endYear, thisYear] = [start, end, today].map(d => d.slice(0, 4));
  if (startYear !== endYear) return `${longDate(start)} – ${longDate(end)}`;
  const suffix = endYear === thisYear ? "" : ` ${endYear}`;
  return start === end ? `${dayMonth(start)}${suffix}` : `${dayMonth(start)} – ${dayMonth(end)}${suffix}`;
}

// ----------------------------------------------------------------------------- target

export interface TargetChip { readonly code: string; readonly label: string }
const SCOPE_NOUN: Readonly<Record<Exclude<AdScope, "ALL">, string>> = { PROVINCE: "provinsi", CITY: "kota", SCHOOL: "sekolah" };
const TARGET_KEY = { PROVINCE: "provinceCodes", CITY: "cityCodes", SCHOOL: "schoolIds" } as const;

export function targetSummary(scope: AdScope, targets: readonly { readonly label: string }[]): string {
  if (scope === "ALL" || targets.length === 0) return "Semua sekolah";
  if (targets.length <= 2) return targets.map(t => t.label).join(", ");
  return `${targets[0]?.label} dan ${targets.length - 1} ${SCOPE_NOUN[scope]} lain`;
}

const targetCode = (t: AdDto["targets"][number]): string => t.provinceCode ?? t.cityCode ?? t.schoolId ?? "";
const sameCodes = (a: readonly TargetChip[], b: readonly TargetChip[]): boolean =>
  a.map(t => t.code).sort().join("|") === b.map(t => t.code).sort().join("|");

function storedTargets(scope: AdScope, targets: readonly TargetChip[]): AdDto["targets"] {
  if (scope === "ALL") return [];
  return targets.map(t => ({ provinceCode: scope === "PROVINCE" ? t.code : null, cityCode: scope === "CITY" ? t.code : null, schoolId: scope === "SCHOOL" ? t.code : null, label: t.label }));
}

/** Provinsi & kota unik dari daftar sekolah target (mode demo tidak memanggil API wilayah). */
export function regionsFromSchools(schools: readonly TargetSchool[]) {
  const provinces = new Map<string, { code: string; name: string }>();
  const cities = new Map<string, { code: string; provinceCode: string; name: string }>();
  for (const s of schools) {
    provinces.set(s.provinceCode, { code: s.provinceCode, name: s.provinceName });
    cities.set(s.cityCode, { code: s.cityCode, provinceCode: s.provinceCode, name: s.cityName });
  }
  const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
  return { provinces: [...provinces.values()].sort(byCode), cities: [...cities.values()].sort(byCode) };
}

// ----------------------------------------------------------------------------- draf editor

export interface CampaignDraft {
  readonly title: string;
  readonly imageFileId: string | null;
  readonly linkType: AdLinkType;
  readonly targetUrl: string;
  readonly scope: AdScope;
  readonly targets: readonly TargetChip[];
  readonly startDate: string;
  readonly endDate: string;
}
export type CampaignField = "banner" | "title" | "targetUrl" | "targets" | "schedule";
export type FieldErrors<F extends string> = Partial<Record<F, string>>;
export const DEFAULT_CAMPAIGN_DAYS = 30;

export function emptyDraft(today: string): CampaignDraft {
  return { title: "", imageFileId: null, linkType: "EXTERNAL_URL", targetUrl: "", scope: "ALL", targets: [], startDate: today, endDate: addDays(today, DEFAULT_CAMPAIGN_DAYS - 1) };
}

export function draftFromAd(ad: AdDto): CampaignDraft {
  return {
    title: ad.title, imageFileId: ad.imageFileId, linkType: ad.linkType, targetUrl: ad.targetUrl, scope: ad.targetScope,
    targets: ad.targets.map(t => ({ code: targetCode(t), label: t.label })), startDate: wibDate(new Date(ad.startAt)), endDate: lastDayOf(ad.endAt),
  };
}

const LINK_REASONS: Readonly<Record<LinkRejectReason, string>> = {
  LENGTH: "Tautan terlalu panjang (maksimal 2.000 karakter).",
  CHARS: "Tautan tidak boleh memuat spasi atau karakter khusus.",
  PARSE: "Tautan tidak valid. Periksa kembali penulisannya.",
  SCHEME: "Tautan web harus diawali https://",
  USERINFO: "Tautan tidak boleh memuat nama pengguna atau kata sandi.",
  HOST: "Gunakan alamat situs yang lengkap, mis. https://contoh.id.",
};
const DEEP_LINK_HINT = "Tautan aplikasi harus memakai skema aplikasi, mis. namaaplikasi://halaman.";

/** Validasi tautan tujuan seperti server; allowlist skema aplikasi tetap diperiksa server. */
export function linkProblem(linkType: AdLinkType, raw: string): string | null {
  const value = raw.trim();
  if (!value) return "Isi tautan tujuan.";
  if (linkType === "EXTERNAL_URL") {
    const result = validateAdLink(value, "EXTERNAL_URL", []);
    return result.ok ? null : LINK_REASONS[result.reason];
  }
  const scheme = /^([^:/?#]+):/.exec(value)?.[1]?.toLowerCase() ?? "";
  if (!SCHEME_PATTERN.test(scheme) || isForbiddenScheme(scheme)) return DEEP_LINK_HINT;
  return /\s/.test(value) ? LINK_REASONS.CHARS : null;
}

/** Domain tanpa skema ("cahayailmu.id/promo") dilengkapi https:// saat kolom ditinggalkan. */
export function normalizeLinkInput(linkType: AdLinkType, raw: string): string {
  const value = raw.trim();
  if (linkType !== "EXTERNAL_URL" || !value || /^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value.replace(/^\/+/, "")}`;
}

function titleProblem(title: string): string | null {
  const value = collapse(title);
  if (value.length < AD_TITLE_MIN) return `Judul minimal ${AD_TITLE_MIN} karakter.`;
  return value.length > AD_TITLE_MAX ? `Judul maksimal ${AD_TITLE_MAX} karakter.` : null;
}

function scheduleProblem(d: CampaignDraft, mode: "draft" | "submit", today: string): string | null {
  if (!d.startDate || !d.endDate) return "Isi tanggal mulai dan selesai.";
  const invalid = scheduleDateProblem(d.startDate, d.endDate);
  if (invalid) return invalid;
  if (d.endDate < d.startDate) return "Tanggal selesai tidak boleh sebelum tanggal mulai.";
  if (daysInclusive(d.startDate, d.endDate) > AD_MAX_DURATION_DAYS) return `Durasi tayang maksimal ${AD_MAX_DURATION_DAYS} hari.`;
  if (d.startDate > addDays(today, AD_MAX_START_LEAD_DAYS)) return `Tanggal mulai maksimal ${AD_MAX_START_LEAD_DAYS} hari ke depan.`;
  if (mode === "submit" && d.endDate < today) return "Tanggal selesai sudah lewat; perpanjang jadwalnya dulu.";
  return null;
}

function targetsProblem(d: CampaignDraft): string | null {
  if (d.scope === "ALL") return null;
  if (d.targets.length === 0) return `Pilih minimal satu ${SCOPE_NOUN[d.scope]}.`;
  return d.targets.length > MAX_TARGETS_PER_AD ? `Maksimal ${MAX_TARGETS_PER_AD} target per kampanye.` : null;
}

/** "draft" = simpan; "submit" = ajukan (jadwal wajib belum berakhir). Kosong = lolos. */
export function validateDraft(d: CampaignDraft, mode: "draft" | "submit", today: string): FieldErrors<CampaignField> {
  const checks: [CampaignField, string | null][] = [
    ["banner", d.imageFileId ? null : "Pilih banner kampanye."], ["title", titleProblem(d.title)], ["targetUrl", linkProblem(d.linkType, d.targetUrl)],
    ["targets", targetsProblem(d)], ["schedule", scheduleProblem(d, mode, today)],
  ];
  return Object.fromEntries(checks.filter(([, message]) => message !== null)) as FieldErrors<CampaignField>;
}

const targetsBody = (scope: AdScope, targets: readonly TargetChip[]) => (scope === "ALL" ? {} : { targets: { [TARGET_KEY[scope]]: targets.map(t => t.code) } });

/** Badan POST /sponsor/ads (strict): ALL tanpa `targets`. */
export function createBody(d: CampaignDraft): Record<string, unknown> {
  return {
    title: collapse(d.title), imageFileId: d.imageFileId, linkType: d.linkType, targetUrl: d.targetUrl.trim(),
    startAt: toStartIso(d.startDate), endAt: toEndIso(d.endDate), targetScope: d.scope, ...targetsBody(d.scope, d.targets),
  };
}

/** Badan PATCH berisi field yang berubah saja + expectedUpdatedAt; null bila tidak ada perubahan. */
export function patchBody(d: CampaignDraft, ad: AdDto): Record<string, unknown> | null {
  const before = draftFromAd(ad);
  const body: Record<string, unknown> = {};
  if (collapse(d.title) !== collapse(before.title)) body.title = collapse(d.title);
  if (d.imageFileId !== before.imageFileId) body.imageFileId = d.imageFileId;
  if (d.linkType !== before.linkType) body.linkType = d.linkType;
  if (d.targetUrl.trim() !== before.targetUrl) body.targetUrl = d.targetUrl.trim();
  if (d.startDate !== before.startDate) body.startAt = toStartIso(d.startDate);
  if (d.endDate !== before.endDate) body.endAt = toEndIso(d.endDate);
  if (d.scope !== before.scope || !sameCodes(d.targets, before.targets)) Object.assign(body, { targetScope: d.scope }, targetsBody(d.scope, d.targets));
  return Object.keys(body).length === 0 ? null : { ...body, expectedUpdatedAt: ad.updatedAt };
}

/**
 * Draf setelah konflik (STATE_CONFLICT): isian yang diubah pengguna terhadap versi lama dipertahankan,
 * sisanya ikut versi terbaru, sehingga simpan ulang tidak menimpa perubahan dari tab/perangkat lain.
 */
export function rebaseDraft(d: CampaignDraft, before: AdDto, latest: AdDto): CampaignDraft {
  const old = draftFromAd(before);
  const fresh = draftFromAd(latest);
  const link = d.linkType !== old.linkType || d.targetUrl.trim() !== old.targetUrl;
  const reach = d.scope !== old.scope || !sameCodes(d.targets, old.targets);
  return {
    title: collapse(d.title) !== collapse(old.title) ? d.title : fresh.title,
    imageFileId: d.imageFileId !== old.imageFileId ? d.imageFileId : fresh.imageFileId,
    linkType: link ? d.linkType : fresh.linkType,
    targetUrl: link ? d.targetUrl : fresh.targetUrl,
    scope: reach ? d.scope : fresh.scope,
    targets: reach ? d.targets : fresh.targets,
    startDate: d.startDate !== old.startDate ? d.startDate : fresh.startDate,
    endDate: d.endDate !== old.endDate ? d.endDate : fresh.endDate,
  };
}

/** Halaman berikutnya ditambahkan; baris yang id-nya sudah ada dilewati (paginasi offset bergeser saat data bertambah). */
export function appendById<T extends { readonly id: string }>(rows: readonly T[], next: readonly T[]): T[] {
  const known = new Set(rows.map(r => r.id));
  return [...rows, ...next.filter(r => !known.has(r.id))];
}

// ----------------------------------------------------------------------------- galat server & banner

export interface ApiFailure { readonly code: string; readonly message: string; readonly details?: unknown }
export interface Failure<F extends string> { readonly field: F | "general"; readonly message: string }

const reasonOf = (details: unknown): string => (details && typeof details === "object" && "reason" in details ? String(details.reason) : "");

/** Field dari galat VALIDATION_FAILED (`details[0].path` = "body.title"). */
function validationFailure<F extends string>(err: ApiFailure, fields: Readonly<Record<string, F>>): Failure<F> | null {
  const first: unknown = Array.isArray(err.details) ? err.details[0] : undefined;
  if (!first || typeof first !== "object" || !("path" in first)) return null;
  const field = fields[String(first.path).split(".")[1] ?? ""];
  return field ? { field, message: "message" in first ? String(first.message) : err.message } : null;
}

const BANNER_REASONS: Readonly<Record<BannerReason, string>> = {
  FORMAT: "Banner harus berupa gambar JPEG, PNG, atau WebP.",
  ANIMATED: "Banner bergerak (animasi) belum didukung. Gunakan gambar diam.",
  TOO_SMALL: "Banner minimal 800×400 piksel (disarankan 1200×600).",
  ASPECT: "Rasio banner harus 2:1, mis. 1200×600 piksel.",
  PIXELS: "Resolusi banner terlalu besar (maksimal 25 megapiksel).",
};
export const HEIC_MESSAGE = "Foto HEIC (format bawaan iPhone) belum didukung. Kirim tangkapan layar, atau atur kamera iPhone ke format “Paling Kompatibel” (JPG).";
const UPLOAD_FAILURES: Readonly<Record<string, string>> = {
  HEIC_NOT_SUPPORTED: HEIC_MESSAGE, UNSUPPORTED_MEDIA_TYPE: BANNER_REASONS.FORMAT,
  IMAGE_UNREADABLE: "Gambar tidak dapat dibaca. Coba simpan ulang atau pilih berkas lain.", PAYLOAD_TOO_LARGE: "Ukuran berkas terlalu besar.",
};
/** Galat karena data kampanye di layar basi (diubah di tab/perangkat lain): pemanggil memuat ulang kampanye itu. */
const STALE_CODES: ReadonlySet<string> = new Set(["STATE_CONFLICT", "AD_INVALID_TRANSITION"]);
export const isStaleCampaign = (err: Pick<ApiFailure, "code">): boolean => STALE_CODES.has(err.code);
export const STALE_RELOAD_FAILED = "Data kampanye berubah, tetapi versi terbarunya gagal dimuat. Tutup lalu buka lagi, atau muat ulang halaman.";

const CAMPAIGN_GENERAL: Readonly<Record<string, string>> = {
  STATE_CONFLICT: "Data kampanye berubah; kami memuat versi terbaru — periksa lalu simpan lagi.",
  AD_INVALID_TRANSITION: "Status kampanye sudah berubah; kami memuat versi terbaru — periksa lalu coba lagi.",
  AD_EDIT_WHILE_PENDING: "Kampanye sedang ditinjau. Tarik pengajuan dulu untuk mengubahnya.",
  SPONSOR_NOT_APPROVED: "Akun sponsor belum disetujui admin, jadi kampanye belum bisa diajukan. Draf tetap tersimpan.",
  SPONSOR_SUSPENDED: "Akun sponsor ditangguhkan; kampanye hanya bisa dilihat.",
  AD_NOT_DELETABLE: "Kampanye yang sudah punya statistik tidak bisa dihapus. Arsipkan saja agar tidak tayang lagi.",
  RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
};
const CAMPAIGN_PATHS: Readonly<Record<string, CampaignField>> = {
  title: "title", imageFileId: "banner", file: "banner", linkType: "targetUrl", targetUrl: "targetUrl", startAt: "schedule", endAt: "schedule", targetScope: "targets", targets: "targets",
};

export function campaignFailure(err: ApiFailure): Failure<CampaignField> {
  const reason = reasonOf(err.details);
  if (err.code === "AD_LINK_INVALID") return { field: "targetUrl", message: reason && reason !== "SCHEME" && reason in LINK_REASONS ? LINK_REASONS[reason as LinkRejectReason] : err.message };
  if (err.code === "BANNER_INVALID") return { field: "banner", message: BANNER_REASONS[reason as BannerReason] ?? err.message };
  if (err.code in UPLOAD_FAILURES) return { field: "banner", message: UPLOAD_FAILURES[err.code] ?? err.message };
  if (err.code === "AD_SCHEDULE_INVALID") return { field: "schedule", message: err.message };
  if (err.code === "AD_TARGETS_INVALID") return { field: "targets", message: err.message };
  if (err.code === "VALIDATION_FAILED") return validationFailure(err, CAMPAIGN_PATHS) ?? { field: "general", message: err.message };
  return { field: "general", message: CAMPAIGN_GENERAL[err.code] ?? err.message };
}

export function isHeic(file: { readonly name: string; readonly type: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}
const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIB = 1024 * 1024;
export const BANNER_MAX_BYTES = UPLOAD_POLICY.AD_BANNER.maxInputBytes;
export const PROOF_MAX_BYTES = UPLOAD_POLICY.TOPUP_PROOF.maxInputBytes;
export const IMAGE_ACCEPT = [...IMAGE_TYPES].join(",");

/** Pemeriksaan berkas banner sebelum dibaca (format & ukuran berkas). */
export function bannerFileProblem(file: { readonly name: string; readonly type: string; readonly size: number }): string | null {
  if (isHeic(file)) return HEIC_MESSAGE;
  if (!IMAGE_TYPES.has(file.type)) return BANNER_REASONS.FORMAT;
  return file.size > BANNER_MAX_BYTES ? `Ukuran banner maksimal ${BANNER_MAX_BYTES / MIB} MB.` : null;
}

/** Dimensi banner dengan aturan server yang sama (2:1 ±2%, minimal 800×400, maks 25 MP). */
export function bannerSizeProblem(width: number, height: number): string | null {
  const reason = checkBannerMeta({ format: "png", width, height, pages: 1 });
  if (reason === "ASPECT") return `Rasio banner harus 2:1 — gambar ini ${width}×${height} piksel. Potong menjadi mis. 1200×600 lalu pilih lagi.`;
  return reason ? BANNER_REASONS[reason] : null;
}

// ----------------------------------------------------------------------------- aksi

export type TransitionKey = "submit" | "withdraw" | "pause" | "resume" | "archive";
export type CampaignActionKey = TransitionKey | "delete" | "edit";
export interface CampaignAction {
  readonly key: CampaignActionKey;
  readonly label: string;
  readonly kind: "primary" | "secondary" | "danger";
  readonly confirm?: string;
  readonly disabledReason?: string;
}
const ACTION_LABELS: Readonly<Record<CampaignActionKey, string>> = {
  submit: "Ajukan tinjauan", withdraw: "Tarik pengajuan", pause: "Jeda penayangan", resume: "Lanjutkan penayangan", archive: "Arsipkan", delete: "Hapus draf", edit: "Ubah",
};
const CONFIRMS: Partial<Record<CampaignActionKey, string>> = {
  archive: "Kampanye yang diarsipkan berhenti tayang dan tidak bisa diaktifkan lagi. Statistiknya tetap tersimpan.",
  delete: "Draf ini akan dihapus permanen beserta pengaturannya.",
};
export const ACTION_DONE: Readonly<Record<CampaignActionKey, string>> = {
  submit: "Kampanye diajukan untuk ditinjau.", withdraw: "Pengajuan ditarik; kampanye kembali menjadi draf.", pause: "Penayangan dijeda.",
  resume: "Penayangan dilanjutkan.", archive: "Kampanye diarsipkan.", delete: "Draf dihapus.", edit: "Perubahan disimpan.",
};
export const SUBMIT_BLOCKED = "Akun sponsor masih diverifikasi admin. Anda tetap bisa menyimpan draf dan mengajukannya nanti.";

const act = (key: CampaignActionKey, kind: CampaignAction["kind"], label = ACTION_LABELS[key]): CampaignAction =>
  CONFIRMS[key] ? { key, kind, label, confirm: CONFIRMS[key] } : { key, kind, label };

function baseActions(ad: Pick<AdDto, "status" | "displayStatus">): CampaignAction[] {
  const ended = ad.displayStatus === "ENDED";
  switch (ad.status) {
    case "DRAFT": return [act("submit", "primary"), act("edit", "secondary"), act("delete", "danger"), act("archive", "danger")];
    case "REJECTED": return [act("edit", "primary", "Perbaiki kampanye"), act("submit", "secondary", "Ajukan ulang"), act("archive", "danger")];
    case "PENDING_REVIEW": return [act("withdraw", "secondary")];
    case "APPROVED": return ended ? [act("edit", "primary", "Perpanjang jadwal"), act("archive", "danger")] : [act("pause", "secondary"), act("edit", "secondary"), act("archive", "danger")];
    case "PAUSED": return ended ? [act("edit", "primary", "Perpanjang jadwal"), act("archive", "danger")] : [act("resume", "primary"), act("edit", "secondary"), act("archive", "danger")];
    default: return [];
  }
}

/** Aksi yang sah untuk status kampanye & akun sponsor (ditangguhkan = hanya baca; belum disetujui = belum bisa mengajukan). */
export function campaignActions(ad: Pick<AdDto, "status" | "displayStatus">, sponsorStatus: SponsorStatus | null): CampaignAction[] {
  if (sponsorStatus === "SUSPENDED") return [];
  return baseActions(ad).map(a => (a.key === "submit" && sponsorStatus === "PENDING" ? { ...a, disabledReason: SUBMIT_BLOCKED } : a));
}

// ----------------------------------------------------------------------------- grafik & demo

/** Batas sumbu y untuk metrik hitungan: kelipatan 4 langkah bulat sehingga garis bantu tidak pecahan. */
export function integerAxisMax(max: number, count = 4): number | undefined {
  if (max <= 0) return undefined;
  return Math.max(1, Math.ceil(niceMax(max / count))) * count;
}

/** "Kampanye diajukan untuk ditinjau." -> "Mode demo: kampanye diajukan untuk ditinjau (simulasi)." */
export function demoNotice(text: string): string {
  const body = text.trim().replace(/\.$/, "");
  return `Mode demo: ${body.charAt(0).toLowerCase()}${body.slice(1)} (simulasi).`;
}

export function demoDisplayStatus(ad: Pick<AdDto, "status" | "startAt" | "endAt">, nowMs: number): DisplayStatus {
  if (ad.status !== "APPROVED" && ad.status !== "PAUSED") return ad.status;
  if (Date.parse(ad.endAt) <= nowMs) return "ENDED";
  if (ad.status === "PAUSED") return "PAUSED";
  return Date.parse(ad.startAt) > nowMs ? "SCHEDULED" : "LIVE";
}
function withDisplay(ad: AdDto, nowIso: string): AdDto {
  const displayStatus = demoDisplayStatus(ad, Date.parse(nowIso));
  return { ...ad, displayStatus, isActive: displayStatus === "LIVE" };
}

const NEXT_STATUS: Readonly<Record<TransitionKey, AdDto["status"]>> = { submit: "PENDING_REVIEW", withdraw: "DRAFT", pause: "PAUSED", resume: "APPROVED", archive: "ARCHIVED" };

export function applyDemoAction(ad: AdDto, action: TransitionKey, nowIso: string): AdDto {
  const submittedAt = action === "submit" ? nowIso : action === "withdraw" ? null : ad.submittedAt;
  const reviewNote = action === "submit" ? null : ad.reviewNote;
  return withDisplay({ ...ad, status: NEXT_STATUS[action], submittedAt, reviewNote, updatedAt: nowIso }, nowIso);
}

export function demoCreateAd(d: CampaignDraft, ctx: { readonly id: string; readonly sponsorId: string; readonly cpc: number; readonly nowIso: string }): AdDto {
  return {
    id: ctx.id, sponsorId: ctx.sponsorId, title: collapse(d.title), imageFileId: d.imageFileId ?? "", imageUrl: null, linkType: d.linkType, targetUrl: d.targetUrl.trim(),
    startAt: asIso(toStartIso(d.startDate)), endAt: asIso(toEndIso(d.endDate)), status: "DRAFT", displayStatus: "DRAFT", isActive: false,
    targetScope: d.scope, targets: storedTargets(d.scope, d.targets), cpcAmount: ctx.cpc, submittedAt: null, reviewNote: null, reviewedAt: null,
    createdAt: ctx.nowIso, updatedAt: ctx.nowIso,
  };
}

/** PATCH demo: iklan disetujui/dijeda yang berubah banner/tautan/target kembali ditinjau (seperti server). */
export function demoPatchAd(ad: AdDto, d: CampaignDraft, nowIso: string): { readonly ad: AdDto; readonly reReviewTriggered: boolean } {
  const before = draftFromAd(ad);
  const contentChanged = d.imageFileId !== before.imageFileId || d.targetUrl.trim() !== before.targetUrl || d.linkType !== before.linkType || d.scope !== before.scope || !sameCodes(d.targets, before.targets);
  const reReview = (ad.status === "APPROVED" || ad.status === "PAUSED") && contentChanged;
  const next: AdDto = {
    ...ad, title: collapse(d.title), imageFileId: d.imageFileId ?? ad.imageFileId, imageUrl: d.imageFileId === ad.imageFileId ? ad.imageUrl : null,
    linkType: d.linkType, targetUrl: d.targetUrl.trim(), targetScope: d.scope, targets: storedTargets(d.scope, d.targets),
    startAt: d.startDate === before.startDate ? ad.startAt : asIso(toStartIso(d.startDate)), endAt: d.endDate === before.endDate ? ad.endAt : asIso(toEndIso(d.endDate)),
    status: reReview ? "PENDING_REVIEW" : ad.status, submittedAt: reReview ? nowIso : ad.submittedAt, updatedAt: nowIso,
  };
  return { ad: withDisplay(next, nowIso), reReviewTriggered: reReview };
}

// ----------------------------------------------------------------------------- saldo & top-up

export const LEDGER_LABELS: Readonly<Record<string, string>> = { TOPUP: "Top-up", CLICK_CHARGE: "Potongan klik", ADJUSTMENT: "Penyesuaian" };
export const QUICK_AMOUNTS: readonly { readonly value: number; readonly label: string }[] = [
  { value: 100_000, label: "100 rb" }, { value: 500_000, label: "500 rb" }, { value: 1_000_000, label: "1 jt" }, { value: 2_000_000, label: "2 jt" },
];

/**
 * Bagian desimal di akhir nominal tempelan: ",00" / ",-" (format Indonesia) atau ".00" setelah ribuan
 * berkoma ("500,000.00"). Titik tanpa koma selalu pemisah ribuan (kolom sendiri memformat "500.000").
 */
const stripDecimals = (text: string): string => text.trim().replace(/,(?:\d{1,2}|-)?$/, "").replace(/(,\d{3})\.\d{1,2}$/, "$1");
/** Isi kolom nominal -> digit saja (tanpa desimal, tanpa nol di depan, maks 9 digit sesuai kontrak). */
export const amountDigits = (text: string): string => stripDecimals(text).replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
export const formatAmountInput = (digits: string): string => (digits ? number(Number(digits)) : "");

export function signedRupiah(amount: number): string {
  if (amount > 0) return `+${rupiah(amount)}`;
  return amount < 0 ? `−${rupiah(-amount)}` : rupiah(0);
}

export interface FileMeta { readonly name: string; readonly type: string; readonly size: number }
export interface TopUpForm {
  readonly amount: string;
  readonly transferDate: string;
  readonly senderName: string;
  readonly senderBank: string;
  readonly note: string;
  readonly file: FileMeta | null;
}
export type TopUpField = "amount" | "transferDate" | "senderName" | "senderBank" | "note" | "file";

function amountProblem(digits: string, min: number): string | null {
  if (!digits) return "Isi nominal top-up.";
  const value = Number(digits);
  if (value < min) return `Minimal top-up ${rupiah(min)}.`;
  return value > TOPUP_MAX ? `Maksimal ${rupiah(TOPUP_MAX)} per pengajuan.` : null;
}

function textProblem(value: string, min: number, max: number, label: string): string | null {
  const length = collapse(value).length;
  if (length < min) return `${label} minimal ${min} karakter.`;
  return length > max ? `${label} maksimal ${max} karakter.` : null;
}

/** Pemeriksaan foto bukti transfer (HEIC ditolak dengan pesan jelas, format, 8 MB). */
export function proofProblem(file: FileMeta | null): string | null {
  if (!file) return "Lampirkan foto bukti transfer.";
  if (isHeic(file)) return HEIC_MESSAGE;
  if (!IMAGE_TYPES.has(file.type)) return "Bukti harus berupa foto JPEG, PNG, atau WebP.";
  return file.size > PROOF_MAX_BYTES ? `Ukuran foto bukti maksimal ${PROOF_MAX_BYTES / MIB} MB.` : null;
}

export function transferDateRange(today: string): { readonly earliest: string; readonly latest: string } {
  return { earliest: addDays(today, -TOPUP_MAX_TRANSFER_AGE_DAYS), latest: today };
}

export function validateTopUp(f: TopUpForm, ctx: { readonly min: number; readonly today: string }): FieldErrors<TopUpField> {
  const { earliest, latest } = transferDateRange(ctx.today);
  const dateOk = f.transferDate >= earliest && f.transferDate <= latest;
  const checks: [TopUpField, string | null][] = [
    ["amount", amountProblem(f.amount, ctx.min)],
    ["transferDate", !f.transferDate ? "Isi tanggal transfer." : dateOk ? null : `Tanggal transfer harus dalam ${TOPUP_MAX_TRANSFER_AGE_DAYS} hari terakhir (${longDate(earliest)} – ${longDate(latest)}).`],
    ["senderName", textProblem(f.senderName, 2, SENDER_NAME_MAX, "Nama pengirim")],
    ["senderBank", textProblem(f.senderBank, 2, SENDER_BANK_MAX, "Bank pengirim")],
    ["note", f.note.trim().length > NOTE_MAX ? `Catatan maksimal ${NOTE_MAX} karakter.` : null],
    ["file", proofProblem(f.file)],
  ];
  return Object.fromEntries(checks.filter(([, message]) => message !== null)) as FieldErrors<TopUpField>;
}

/** Field teks multipart POST /sponsor/topups (berkas `file` ditambahkan pemanggil); catatan hanya bila diisi. */
export function topUpTextFields(f: TopUpForm): [string, string][] {
  const fields: [string, string][] = [["amount", f.amount], ["transferDate", f.transferDate], ["senderName", collapse(f.senderName)], ["senderBank", collapse(f.senderBank)]];
  const note = f.note.trim();
  return note ? [...fields, ["note", note]] : fields;
}

const TOPUP_GENERAL: Readonly<Record<string, string>> = {
  TOPUP_LIMIT: `Masih ada ${MAX_PENDING_TOPUPS} pengajuan top-up yang menunggu verifikasi. Tunggu salah satunya diproses, atau batalkan yang keliru.`,
  SPONSOR_NOT_APPROVED: "Top-up bisa diajukan setelah akun sponsor disetujui admin.",
  SPONSOR_SUSPENDED: "Akun sponsor ditangguhkan, jadi top-up tidak dapat diajukan.",
  RATE_LIMITED: CAMPAIGN_GENERAL.RATE_LIMITED ?? "",
};
const PROOF_FAILURES: Readonly<Record<string, string>> = {
  HEIC_NOT_SUPPORTED: HEIC_MESSAGE, UNSUPPORTED_MEDIA_TYPE: "Bukti harus berupa foto JPEG, PNG, atau WebP.",
  IMAGE_UNREADABLE: "Foto bukti tidak dapat dibaca. Coba foto ulang atau pilih berkas lain.",
  IMAGE_TOO_LARGE: "Resolusi foto bukti terlalu besar.", PAYLOAD_TOO_LARGE: `Ukuran foto bukti maksimal ${PROOF_MAX_BYTES / MIB} MB.`,
};
const TOPUP_PATHS: Readonly<Record<string, TopUpField>> = { amount: "amount", transferDate: "transferDate", senderName: "senderName", senderBank: "senderBank", note: "note", file: "file" };
const detail = (details: unknown, key: string): unknown => (details && typeof details === "object" && key in details ? (details as Record<string, unknown>)[key] : undefined);

export function topUpFailure(err: ApiFailure): Failure<TopUpField> {
  const [min, max, earliest, latest] = ["min", "max", "earliest", "latest"].map(key => detail(err.details, key));
  if (err.code === "TOPUP_AMOUNT_INVALID" && typeof min === "number" && typeof max === "number") return { field: "amount", message: `Nominal harus antara ${rupiah(min)} dan ${rupiah(max)}.` };
  if (err.code === "TRANSFER_DATE_OUT_OF_RANGE" && typeof earliest === "string" && typeof latest === "string") {
    return { field: "transferDate", message: `Tanggal transfer harus antara ${longDate(earliest)} dan ${longDate(latest)}.` };
  }
  if (err.code in PROOF_FAILURES) return { field: "file", message: PROOF_FAILURES[err.code] ?? err.message };
  if (err.code === "VALIDATION_FAILED") return validationFailure(err, TOPUP_PATHS) ?? { field: "general", message: err.message };
  return { field: "general", message: TOPUP_GENERAL[err.code] ?? err.message };
}

export function topUpBlockReason(ctx: { readonly account: SponsorBalanceDto["topUpAccount"]; readonly sponsorStatus: SponsorStatus | null; readonly pending: number }): string | null {
  if (ctx.sponsorStatus === "SUSPENDED") return TOPUP_GENERAL.SPONSOR_SUSPENDED ?? null;
  if (ctx.sponsorStatus === "PENDING") return TOPUP_GENERAL.SPONSOR_NOT_APPROVED ?? null;
  if (!ctx.account) return "Rekening tujuan belum diatur admin. Top-up dibuka setelah rekening tersedia.";
  return ctx.pending >= MAX_PENDING_TOPUPS ? `Sudah ada ${MAX_PENDING_TOPUPS} pengajuan menunggu verifikasi. Tunggu salah satunya diproses sebelum mengajukan lagi.` : null;
}

/** Pengajuan top-up demo (PENDING) dari isi formulir. */
export function demoTopUp(f: TopUpForm, ctx: { readonly id: string; readonly sponsorId: string; readonly proofFileId: string; readonly nowIso: string }): TopUpDto {
  const note = f.note.trim();
  return {
    id: ctx.id, sponsorId: ctx.sponsorId, amount: Number(f.amount), transferDate: f.transferDate, senderName: collapse(f.senderName), senderBank: collapse(f.senderBank),
    note: note || null, status: "PENDING", reviewNote: null, reviewedAt: null, proofFileId: ctx.proofFileId, createdAt: ctx.nowIso,
  };
}

/** Kelompok per hari WIB (urutan masukan dipertahankan): "Hari ini", "Kemarin", lalu tanggal. */
export function groupByDay<T extends { readonly createdAt: string }>(entries: readonly T[], today: string): { date: string; label: string; entries: T[] }[] {
  const groups: { date: string; label: string; entries: T[] }[] = [];
  for (const entry of entries) {
    const date = wibDate(new Date(entry.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.entries.push(entry);
    else groups.push({ date, label: date === today ? "Hari ini" : date === addDays(today, -1) ? "Kemarin" : longDate(date), entries: [entry] });
  }
  return groups;
}

/** Perkiraan hari saldo cukup dengan rata-rata pemakaian 7 hari; null bila belum ada pemakaian. */
export function runwayDays(balance: number, spend7d: number): number | null {
  if (spend7d <= 0) return null;
  return Math.max(0, Math.floor(balance / (spend7d / 7)));
}

/** Porsi saldo tersisa dari seluruh dana masuk (top-up + penyesuaian), 0..1. */
export function remainingShare(balance: number, totalTopUp: number, netAdjustment: number): number {
  const total = totalTopUp + netAdjustment;
  return total <= 0 ? 0 : Math.min(1, Math.max(0, balance / total));
}
