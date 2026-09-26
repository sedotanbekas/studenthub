/**
 * Aturan murni halaman peninjauan super admin (moderasi iklan & verifikasi top-up): validasi alasan,
 * teks waktu relatif, jadwal tayang (WIB), perpindahan item antar-tab setelah diputuskan, dan arti
 * kode galat peninjauan. Tanpa DOM/Prisma agar bisa diuji dengan node:test.
 */

export const REASON_MIN = 5;
export const REASON_MAX = 255;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const ZONE = "Asia/Jakarta";

/** Pesan galat alasan tolak/turunkan (5..255 karakter setelah dipangkas); null = valid. */
export function reasonError(text: string): string | null {
  const length = text.trim().length;
  if (length === 0) return "Tulis alasan agar sponsor tahu apa yang perlu diperbaiki.";
  if (length < REASON_MIN) return `Alasan minimal ${REASON_MIN} karakter.`;
  if (length > REASON_MAX) return `Alasan maksimal ${REASON_MAX} karakter (sekarang ${length}).`;
  return null;
}

/** Chip alasan cepat: isi bila kosong, tambahkan sebagai kalimat baru, abaikan bila sudah ada. */
export function withQuickReason(current: string, chip: string): string {
  const base = current.trim();
  if (!base) return chip;
  if (hasQuickReason(base, chip)) return base;
  return `${base.replace(/[.\s]+$/, "")}. ${chip}`;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Chip sebagai kalimat utuh: diawali awal teks atau titik, diakhiri titik atau akhir teks. Titik di
 * dalam kalimat lain (Rp1.000.000, nama domain) tidak disentuh.
 */
const chipSentence = (chip: string): RegExp => new RegExp(`(^|\\.)\\s*${escapeRegExp(chip)}\\s*(\\.|$)`);

/** Chip alasan cepat sudah ada sebagai kalimat utuh di alasan. */
export function hasQuickReason(current: string, chip: string): boolean {
  return chip.trim() !== "" && chipSentence(chip).test(current);
}

/** Buang satu kemunculan kalimat chip beserta satu pemisah titiknya; teks lain dibiarkan apa adanya. */
function withoutChip(current: string, chip: string): string {
  const match = chipSentence(chip).exec(current);
  if (!match) return current;
  const before = current.slice(0, match.index).trimEnd();
  const after = current.slice(match.index + match[0].length);
  if (!before) return after.trimStart();
  if (!after.trim()) return before;
  return `${before}.${after}`;
}

/** Chip bersifat tombol-alih: pilih = tambahkan kalimat, pilih lagi = lepas (semua) kalimat itu saja. */
export function toggleQuickReason(current: string, chip: string): string {
  return hasQuickReason(current, chip) ? withoutAllChips(current, chip) : withQuickReason(current, chip);
}

/** Setiap langkah memendekkan teks (chip tidak kosong), jadi rekursi pasti berhenti. */
function withoutAllChips(current: string, chip: string): string {
  return hasQuickReason(current, chip) ? withoutAllChips(withoutChip(current, chip), chip) : current;
}

/** Durasi singkat: "15 menit", "4 jam", "12 hari" (dibulatkan ke bawah). */
function durationText(ms: number): string {
  if (ms < HOUR_MS) return `${Math.max(1, Math.floor(ms / MINUTE_MS))} menit`;
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)} jam`;
  return `${Math.floor(ms / DAY_MS)} hari`;
}

/** "baru saja", "15 menit lalu", "1 hari lalu" — waktu di masa depan (jam tidak sinkron) = baru saja. */
export function timeAgo(iso: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(iso);
  return elapsed < MINUTE_MS ? "baru saja" : `${durationText(elapsed)} lalu`;
}

export type ScheduleState = "upcoming" | "running" | "ended";
export interface ScheduleInfo { readonly range: string; readonly days: number; readonly state: ScheduleState; readonly note: string }

const dayMonth = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: ZONE });
const dayMonthYear = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: ZONE });
const yearOf = (date: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone: ZONE }).format(date);

/** Jadwal tayang: rentang tanggal WIB (akhir inklusif), lama tayang (hari), dan posisinya terhadap sekarang. */
export function scheduleInfo(startIso: string, endIso: string, now: Date): ScheduleInfo {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  const startDate = new Date(start);
  const lastMoment = new Date(end - 1);
  const sameYear = yearOf(startDate) === yearOf(lastMoment);
  const range = `${(sameYear ? dayMonth : dayMonthYear).format(startDate)} – ${dayMonthYear.format(lastMoment)}`;
  const days = Math.max(1, Math.ceil((end - start) / DAY_MS));
  const t = now.getTime();
  if (t >= end) return { range, days, state: "ended", note: "Jadwal tayang sudah berakhir" };
  if (t < start) return { range, days, state: "upcoming", note: `Mulai tayang dalam ${durationText(start - t)}` };
  return { range, days, state: "running", note: `Sedang dalam periode tayang · berakhir dalam ${durationText(end - t)}` };
}

export interface ApprovalInput { readonly sponsorStatus: string; readonly endAt: string; readonly submittedAt: string | null }

/** Alasan iklan menunggu tinjauan belum bisa disetujui (sama dengan penolakan server); null = boleh. */
export function approveBlocker(ad: ApprovalInput, now: Date): string | null {
  if (!ad.submittedAt) return "Iklan ini belum diajukan untuk ditinjau.";
  if (ad.sponsorStatus !== "APPROVED") return "Sponsor belum berstatus disetujui, jadi iklannya belum bisa disetujui. Tinjau sponsornya dulu atau tolak dengan alasan.";
  if (Date.parse(ad.endAt) <= now.getTime()) return "Jadwal tayang sudah berakhir. Tolak dengan alasan agar sponsor memperbarui jadwal.";
  return null;
}

/** Ringkasan jangkauan untuk kalimat: "semua sekolah", "A dan B", "A, B, dan 2 lainnya". */
export function reachSummary(scope: string, labels: readonly string[]): string {
  if (scope === "ALL" || labels.length === 0) return "semua sekolah";
  const [first, second] = labels;
  if (labels.length === 1) return first ?? "";
  if (labels.length === 2) return `${first} dan ${second}`;
  return `${first}, ${second}, dan ${labels.length - 2} lainnya`;
}

/**
 * Terapkan keputusan lokal (mode demo, atau sebelum daftar dimuat ulang) lalu saring per status tab.
 * Data asal tidak dimutasi.
 */
export function applyPatches<T extends { readonly id: string; readonly status: string }>(items: readonly T[], patches: Readonly<Record<string, Partial<T>>>, status: string): T[] {
  return items.map(item => {
    const patch = patches[item.id];
    return patch ? { ...item, ...patch } : item;
  }).filter(item => item.status === status);
}

/** Item yang dipilih berikutnya setelah `id` keluar dari antrean: berikutnya, atau sebelumnya di ujung. */
export function nextAfter(ids: readonly string[], id: string): string | null {
  const index = ids.indexOf(id);
  if (index < 0) return ids[0] ?? null;
  const rest = ids.filter(other => other !== id);
  return rest[index] ?? rest[index - 1] ?? null;
}

export interface ReviewFailure { readonly reload: boolean; readonly hint: string | null }

/** Arti kode galat peninjauan: apakah data perlu dimuat ulang, dan petunjuk tambahan untuk peninjau. */
export function reviewFailure(code: string): ReviewFailure {
  switch (code) {
    case "AD_REVIEW_STALE": return { reload: true, hint: "Data terbaru sudah dimuat — periksa lagi sebelum memutuskan." };
    case "AD_INVALID_TRANSITION": return { reload: true, hint: "Status terbaru sudah dimuat." };
    case "TOPUP_ALREADY_REVIEWED": return { reload: true, hint: "Daftar sudah diperbarui." };
    case "AD_SCHEDULE_INVALID": return { reload: false, hint: "Minta sponsor memperbarui jadwal tayang lalu mengajukan ulang." };
    case "CONFLICT_RETRY": return { reload: false, hint: "Saldo sponsor sedang diperbarui bersamaan. Coba lagi sebentar." };
    default: return { reload: false, hint: null };
  }
}

/**
 * Tautan tujuan yang aman dibuka peninjau: hanya http/https. Skema lain (javascript:, data:, deep link
 * aplikasi) ditampilkan sebagai teks saja — pertahanan berlapis di atas validasi server.
 */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Item terpilih: pilihan pengguna bila masih ada di daftar; di layar lebar otomatis item pertama. */
export function resolveSelection(picked: string | null, ids: readonly string[], autoFirst: boolean): string | null {
  if (picked && ids.includes(picked)) return picked;
  return autoFirst ? ids[0] ?? null : null;
}

const dateTimeWib = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ZONE });

/** "25 Sep 2026, 09.30 WIB". */
export function wibDateTime(iso: string): string {
  return `${dateTimeWib.format(new Date(iso))} WIB`;
}

const calendarFormat = {
  long: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  short: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
};

/** Tanggal kalender "YYYY-MM-DD" (mis. tanggal transfer) → "25 September 2026"; teks asli bila tidak valid. */
export function calendarDate(date: string, style: keyof typeof calendarFormat = "long"): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) ? date : calendarFormat[style].format(new Date(time));
}

/** Panjang maksimal kata kunci pencarian (sama dengan validasi `q` di API). */
export const SEARCH_MAX = 100;

/** Kata kunci pencarian siap kirim: dipangkas dan dibatasi 100 karakter; "" = tanpa pencarian. */
export function normalizeSearch(raw: string): string {
  return raw.trim().slice(0, SEARCH_MAX).trim();
}

/** Pencarian lokal (mode demo): judul memuat kata kunci, tanpa peduli huruf besar/kecil. */
export function matchesSearch(text: string, query: string): boolean {
  return text.toLocaleLowerCase("id-ID").includes(query.toLocaleLowerCase("id-ID"));
}

/** Gabungkan halaman berikutnya ke daftar yang sudah dimuat; id yang sudah ada tidak diulang. */
export function mergeById<T extends { readonly id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(current.map(item => item.id));
  const fresh = incoming.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [...current, ...fresh];
}

/** "Menampilkan 50 dari 120" bila belum semua termuat; null bila semua sudah tampil. */
export function shownOfTotal(shown: number, total: number): string | null {
  return total > shown ? `Menampilkan ${shown} dari ${total}` : null;
}

/** Jumlah nominal hanya utuh bila semua baris termuat; selain itu diberi label sebagiannya. */
export function loadedSum(sumText: string, shown: number, total: number): string {
  return shown >= total ? sumText : `${sumText} (dari ${shown} yang ditampilkan)`;
}

/** Label tab dengan jumlah bila ada: "Menunggu (2)". */
export function countLabel(base: string, count: number | null): string {
  return count ? `${base} (${count})` : base;
}

/** Rujukan singkat id untuk ditampilkan ("#AB12CD"). */
export function shortRef(id: string): string {
  return `#${id.slice(-6).toUpperCase()}`;
}
