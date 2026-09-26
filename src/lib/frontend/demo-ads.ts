import type {
  AdDto, AdPerformanceDto, AdSettingsDto, AnalyticsBreakdown, AnalyticsDay, AnalyticsPeriod, AnalyticsPreset, AnalyticsSeries, AnalyticsSummary,
  Kpi, LedgerEntryDto, PlatformTopUpDto, ReviewAdDto, ServedAds, SponsorBalanceDto, SponsorDto, SponsorListItemDto, TargetSchool, TopUpDto,
} from "./ad-types";
import { DEMO_FILE_PREFIX } from "./ad-media";

/**
 * Data contoh iklan & sponsor untuk mode demo, satu cerita untuk semua peran: siswa melihat iklan
 * yang tayang, sponsor (PT Cahaya Ilmu Nusantara) melihat kampanye/analitik/saldonya, super admin
 * melihat antrean moderasi & top-up. Bentuk persis DTO API; tanggal relatif terhadap hari ini (WIB).
 */
const CPC = 500;
const DAY_MS = 86_400_000;

/** Tanggal hari ini di WIB, format YYYY-MM-DD. */
export function wibToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
/** Waktu ISO (UTC) untuk jam WIB tertentu pada tanggal lokal. */
const atWib = (date: string, hour: number, minute = 0): string => new Date(Date.parse(`${date}T00:00:00Z`) + ((hour - 7) * 60 + minute) * 60_000).toISOString();

type SponsorKey = "cahaya" | "pena" | "aksara" | "koperasi";
interface DemoSponsor { readonly id: string; readonly companyName: string; readonly status: "PENDING" | "APPROVED" | "SUSPENDED"; readonly email: string; readonly joinedDaysAgo: number }
const SPONSORS: Record<SponsorKey, DemoSponsor> = {
  cahaya: { id: "demo-sponsor", companyName: "PT Cahaya Ilmu Nusantara", status: "APPROVED", email: "kemitraan@cahayailmu.example", joinedDaysAgo: 40 },
  pena: { id: "demo-sponsor-pena", companyName: "Toko Buku Pena Nusantara", status: "APPROVED", email: "promo@penanusantara.example", joinedDaysAgo: 35 },
  aksara: { id: "demo-sponsor-aksara", companyName: "Aksara Digital Academy", status: "APPROVED", email: "halo@aksaradigital.example", joinedDaysAgo: 18 },
  koperasi: { id: "demo-sponsor-koperasi", companyName: "Koperasi Siswa Mandiri", status: "PENDING", email: "pengurus@kopsis.example", joinedDaysAgo: 1 },
};
export const DEMO_SPONSOR_ID = SPONSORS.cahaya.id;

interface AdSeed {
  readonly id: string; readonly sponsor: SponsorKey; readonly title: string; readonly banner: string; readonly targetUrl: string;
  readonly status: AdDto["status"]; readonly scope: AdDto["targetScope"]; readonly targets: AdDto["targets"];
  /** Jadwal relatif hari ini (hari). */
  readonly start: number; readonly end: number; readonly submittedDaysAgo?: number; readonly reviewNote?: string;
  /** Tayangan harian dasar saat tayang (0 = tidak punya trafik). */
  readonly traffic: number;
}
const JAKARTA_BARAT = [{ provinceCode: "31", cityCode: null, schoolId: null, label: "DKI Jakarta" }, { provinceCode: "32", cityCode: null, schoolId: null, label: "Jawa Barat" }];
const AD_SEEDS: readonly AdSeed[] = [
  { id: "ad-bimbel", sponsor: "cahaya", title: "Belajar 20 menit sehari bersama Bimbel Cahaya", banner: "bimbel-cahaya.svg", targetUrl: "https://cahayailmu.example/belajar-20-menit", status: "APPROVED", scope: "ALL", targets: [], start: -24, end: 40, submittedDaysAgo: 25, traffic: 520 },
  { id: "ad-tryout", sponsor: "cahaya", title: "Tryout UTBK gratis setiap Sabtu", banner: "tryout-cahaya.svg", targetUrl: "https://cahayailmu.example/tryout", status: "APPROVED", scope: "PROVINCE", targets: JAKARTA_BARAT, start: -12, end: 30, submittedDaysAgo: 13, traffic: 330 },
  { id: "ad-beasiswa", sponsor: "cahaya", title: "Beasiswa Cahaya Prestasi 2027", banner: "beasiswa-cahaya.svg", targetUrl: "https://cahayailmu.example/beasiswa", status: "PENDING_REVIEW", scope: "ALL", targets: [], start: 2, end: 60, submittedDaysAgo: 1, traffic: 0 },
  { id: "ad-coding", sponsor: "cahaya", title: "Kelas coding akhir pekan untuk pemula", banner: "coding-cahaya.svg", targetUrl: "https://cahayailmu.example/coding", status: "DRAFT", scope: "CITY", targets: [{ provinceCode: null, cityCode: "31.71", schoolId: null, label: "Kota Jakarta Pusat" }], start: 7, end: 37, traffic: 0 },
  { id: "ad-pena", sponsor: "pena", title: "Diskon 20% alat tulis sekolah", banner: "pena-alat-tulis.svg", targetUrl: "https://penanusantara.example/promo-semester", status: "APPROVED", scope: "ALL", targets: [], start: -9, end: 21, submittedDaysAgo: 10, traffic: 410 },
  { id: "ad-buku", sponsor: "pena", title: "Buku catatan dari kertas daur ulang", banner: "pena-buku-daur-ulang.svg", targetUrl: "https://penanusantara.example/buku-hijau", status: "PENDING_REVIEW", scope: "ALL", targets: [], start: 1, end: 31, submittedDaysAgo: 0, traffic: 0 },
  { id: "ad-intensif", sponsor: "cahaya", title: "Kelas intensif ujian akhir", banner: "intensif-cahaya.svg", targetUrl: "https://cahayailmu.example/intensif", status: "REJECTED", scope: "ALL", targets: [], start: 1, end: 30, submittedDaysAgo: 4, reviewNote: "Klaim \"dijamin lulus 100%\" tidak dapat diverifikasi dan kurang pantas untuk pelajar. Ganti dengan klaim yang bisa dibuktikan, lalu ajukan ulang.", traffic: 0 },
  { id: "ad-aksara-webinar", sponsor: "aksara", title: "Webinar gratis: bikin portofolio desain pertamamu", banner: "aksara-desain.svg", targetUrl: "https://aksaradigital.example/webinar", status: "PAUSED", scope: "ALL", targets: [], start: -3, end: 20, submittedDaysAgo: 5, traffic: 0 },
  { id: "ad-aksara", sponsor: "aksara", title: "Belajar desain grafis langsung dari HP", banner: "aksara-desain.svg", targetUrl: "https://aksaradigital.example/desain", status: "APPROVED", scope: "ALL", targets: [], start: -6, end: 24, submittedDaysAgo: 7, traffic: 280 },
];

function displayStatusOf(seed: AdSeed): AdDto["displayStatus"] {
  if (seed.status === "DRAFT" || seed.status === "PENDING_REVIEW" || seed.status === "REJECTED" || seed.status === "ARCHIVED") return seed.status;
  if (seed.end <= 0) return "ENDED";
  if (seed.status === "PAUSED") return "PAUSED";
  if (SPONSORS[seed.sponsor].status !== "APPROVED") return "SPONSOR_INACTIVE";
  return seed.start > 0 ? "SCHEDULED" : "LIVE";
}

function buildAd(seed: AdSeed, today: string): AdDto {
  const displayStatus = displayStatusOf(seed);
  const published = seed.status === "APPROVED" || seed.status === "PAUSED";
  const submitted = seed.submittedDaysAgo === undefined ? null : atWib(addDays(today, -seed.submittedDaysAgo), 9, 30);
  const reviewed = (published || seed.status === "REJECTED") && submitted ? atWib(addDays(today, -(seed.submittedDaysAgo ?? 0) + 1), 10) : null;
  return {
    id: seed.id, sponsorId: SPONSORS[seed.sponsor].id, title: seed.title, imageFileId: `${DEMO_FILE_PREFIX}ads/${seed.banner}`,
    imageUrl: published ? `/demo/ads/${seed.banner}` : null, linkType: "EXTERNAL_URL", targetUrl: seed.targetUrl,
    startAt: atWib(addDays(today, seed.start), 0), endAt: atWib(addDays(today, seed.end), 0), status: seed.status, displayStatus,
    isActive: displayStatus === "LIVE", targetScope: seed.scope, targets: seed.targets, cpcAmount: CPC,
    submittedAt: seed.status === "DRAFT" ? null : submitted, reviewNote: seed.reviewNote ?? null, reviewedAt: reviewed,
    createdAt: atWib(addDays(today, -(seed.submittedDaysAgo ?? 2) - 1), 14), updatedAt: atWib(addDays(today, -(seed.submittedDaysAgo ?? 0)), 9, 30),
  };
}

function buildReviewAd(seed: AdSeed, today: string): ReviewAdDto {
  const sponsor = SPONSORS[seed.sponsor];
  return { ...buildAd(seed, today), sponsor: { id: sponsor.id, companyName: sponsor.companyName, status: sponsor.status, balance: sponsorBalance(seed.sponsor, today) }, urlHost: new URL(seed.targetUrl).host, isPunycodeHost: false };
}

/** Kampanye milik sponsor demo (PT Cahaya Ilmu Nusantara), terbaru dulu. */
export function demoSponsorAds(today: string = wibToday()): AdDto[] {
  return AD_SEEDS.filter(s => s.sponsor === "cahaya").map(s => buildAd(s, today)).reverse();
}
export function demoSponsorAd(id: string, today: string = wibToday()): AdDto | null {
  const seed = AD_SEEDS.find(s => s.id === id && s.sponsor === "cahaya");
  return seed ? buildAd(seed, today) : null;
}

/** Iklan yang tayang untuk siswa: urutan campur antar-sponsor, maks 2 per sponsor (seperti rotasi server). */
export function demoServedAds(): ServedAds {
  const order = ["ad-pena", "ad-bimbel", "ad-aksara", "ad-tryout"];
  const seeds = order.flatMap(id => AD_SEEDS.filter(s => s.id === id && displayStatusOf(s) === "LIVE"));
  const ads = seeds.map(s => ({ token: `demo-token-${s.id}`, adId: s.id, title: s.title, imageUrl: `/demo/ads/${s.banner}`, targetUrl: s.targetUrl, linkType: "EXTERNAL_URL" as const, sponsorName: SPONSORS[s.sponsor].companyName }));
  return { ads, refreshAfterSeconds: 1800 };
}

/** Antrean moderasi super admin; default hanya yang menunggu tinjauan, terlama diajukan dulu (sama seperti API). */
export function demoReviewAds(status: AdDto["status"] | "ALL" = "PENDING_REVIEW", today: string = wibToday()): ReviewAdDto[] {
  const seeds = AD_SEEDS.filter(s => status === "ALL" || s.status === status);
  const sorted = status === "PENDING_REVIEW" ? [...seeds].sort((a, b) => (b.submittedDaysAgo ?? 0) - (a.submittedDaysAgo ?? 0)) : seeds;
  return sorted.map(s => buildReviewAd(s, today));
}
export function demoReviewAd(id: string, today: string = wibToday()): ReviewAdDto | null {
  const seed = AD_SEEDS.find(s => s.id === id);
  return seed ? buildReviewAd(seed, today) : null;
}

// ----------------------------------------------------------------------------- trafik & analitik

/** Hari dalam minggu (0 = Minggu) untuk tanggal lokal. */
const weekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
const EMPTY_DAY = { impressions: 0, clicks: 0, uniqueClicks: 0, chargedClicks: 0, spend: 0 };

/** Trafik harian deterministik satu iklan: ramai di hari sekolah, sepi akhir pekan, hari ini baru separuh. */
function adDay(seed: AdSeed, date: string, today: string): AnalyticsDay {
  const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (seed.traffic === 0 || offset < seed.start || offset >= seed.end || offset > 0) return { date, ...EMPTY_DAY };
  const phase = seed.id.length;
  const weekend = [0, 6].includes(weekday(date)) ? 0.42 : 1;
  const partial = offset === 0 ? 0.55 : 1;
  const impressions = Math.round(seed.traffic * weekend * partial * (1 + 0.14 * Math.sin(offset * 0.9 + phase)));
  const clicks = Math.round(impressions * (0.031 + 0.007 * Math.sin(offset * 1.7 + phase)));
  const chargedClicks = Math.round(clicks * 0.92);
  return { date, impressions, clicks, uniqueClicks: Math.round(clicks * 0.9), chargedClicks, spend: chargedClicks * CPC };
}

const sumDays = (days: readonly AnalyticsDay[], date: string): AnalyticsDay => days.reduce((a, d) => ({
  date, impressions: a.impressions + d.impressions, clicks: a.clicks + d.clicks, uniqueClicks: a.uniqueClicks + d.uniqueClicks, chargedClicks: a.chargedClicks + d.chargedClicks, spend: a.spend + d.spend,
}), { date, ...EMPTY_DAY });

const sponsorSeeds = (sponsor: SponsorKey, adId?: string) => AD_SEEDS.filter(s => s.sponsor === sponsor && (!adId || s.id === adId));
const presetDays = (preset: AnalyticsPreset): number => (preset === "30d" ? 30 : 7);

function periodOf(preset: AnalyticsPreset, today: string): AnalyticsPeriod {
  const days = presetDays(preset);
  const from = addDays(today, -(days - 1));
  return { from, to: today, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}
function daysBetween(from: string, count: number, seeds: readonly AdSeed[], today: string): AnalyticsDay[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i)).map(date => sumDays(seeds.map(s => adDay(s, date, today)), date));
}

export function demoAnalyticsSeries(preset: AnalyticsPreset = "7d", today: string = wibToday(), adId?: string): AnalyticsSeries {
  const period = periodOf(preset, today);
  return { period, days: daysBetween(period.from, period.days, sponsorSeeds("cahaya", adId), today) };
}

const changePct = (value: number, previous: number): number | null => (previous === 0 ? (value === 0 ? 0 : null) : Math.round(((value - previous) / previous) * 1000) / 10);
const kpi = (value: number, previous: number): Kpi => ({ value, previous, changePct: changePct(value, previous) });
const ctrOf = (d: AnalyticsDay): number | null => (d.impressions === 0 ? null : Math.round((d.clicks / d.impressions) * 10_000) / 100);

export function demoAnalyticsSummary(preset: AnalyticsPreset = "7d", today: string = wibToday(), adId?: string): AnalyticsSummary {
  const period = periodOf(preset, today);
  const seeds = sponsorSeeds("cahaya", adId);
  const now = sumDays(daysBetween(period.from, period.days, seeds, today), period.to);
  const prev = sumDays(daysBetween(period.prevFrom, period.days, seeds, today), period.prevTo);
  const ctrNow = ctrOf(now);
  const ctrPrev = ctrOf(prev);
  return {
    period,
    kpis: {
      impressions: kpi(now.impressions, prev.impressions), clicks: kpi(now.clicks, prev.clicks), uniqueClicks: kpi(now.uniqueClicks, prev.uniqueClicks),
      ctr: { value: ctrNow, previous: ctrPrev, changePct: ctrNow === null || ctrPrev === null ? null : changePct(ctrNow, ctrPrev) },
      spend: kpi(now.spend, prev.spend), chargedClicks: kpi(now.chargedClicks, prev.chargedClicks),
    },
  };
}

const DEVICE_SHARE = [["MOBILE", "Ponsel", 81.4], ["TABLET", "Tablet", 11.2], ["DESKTOP", "Komputer", 7.4]] as const;
const PROVINCE_SHARE = [["31", "DKI Jakarta", 46.3], ["32", "Jawa Barat", 38.1], ["36", "Banten", 15.6]] as const;

export function demoAnalyticsBreakdown(dimension: "device" | "province" = "device", preset: AnalyticsPreset = "7d", today: string = wibToday()): AnalyticsBreakdown {
  const period = periodOf(preset, today);
  const total = sumDays(daysBetween(period.from, period.days, sponsorSeeds("cahaya"), today), period.to).clicks;
  const shares = dimension === "device" ? DEVICE_SHARE : PROVINCE_SHARE;
  return { period, dimension, items: shares.map(([key, label, sharePct]) => ({ key, label, sharePct, clicks: Math.round((total * sharePct) / 100) })) };
}

export function demoAdPerformance(preset: AnalyticsPreset = "7d", today: string = wibToday()): AdPerformanceDto[] {
  const period = periodOf(preset, today);
  return sponsorSeeds("cahaya").map(seed => {
    const ad = buildAd(seed, today);
    const total = sumDays(daysBetween(period.from, period.days, [seed], today), period.to);
    return { adId: ad.id, title: ad.title, imageUrl: ad.imageUrl, status: ad.status, displayStatus: ad.displayStatus, isActive: ad.isActive, startAt: ad.startAt, endAt: ad.endAt, impressions: total.impressions, clicks: total.clicks, uniqueClicks: total.uniqueClicks, ctr: ctrOf(total), spend: total.spend };
  }).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.title.localeCompare(b.title));
}

// ----------------------------------------------------------------------------- saldo, ledger, top-up

interface TopUpSeed { readonly id: string; readonly sponsor: SponsorKey; readonly amount: number; readonly daysAgo: number; readonly status: TopUpDto["status"]; readonly reviewNote?: string; readonly bank: string; readonly proof?: string }
const TOPUPS: readonly TopUpSeed[] = [
  { id: "tu-cahaya-4", sponsor: "cahaya", amount: 500_000, daysAgo: 1, status: "PENDING", bank: "BCA" },
  { id: "tu-aksara-1", sponsor: "aksara", amount: 1_500_000, daysAgo: 0, status: "PENDING", bank: "Mandiri", proof: "bukti-transfer-aksara.svg" },
  { id: "tu-cahaya-3", sponsor: "cahaya", amount: 2_000_000, daysAgo: 20, status: "APPROVED", bank: "BCA" },
  { id: "tu-pena-1", sponsor: "pena", amount: 2_500_000, daysAgo: 12, status: "APPROVED", bank: "BRI" },
  { id: "tu-aksara-0", sponsor: "aksara", amount: 1_000_000, daysAgo: 8, status: "APPROVED", bank: "Mandiri" },
  { id: "tu-cahaya-2", sponsor: "cahaya", amount: 3_000_000, daysAgo: 26, status: "APPROVED", bank: "BCA" },
  { id: "tu-cahaya-1", sponsor: "cahaya", amount: 1_000_000, daysAgo: 27, status: "REJECTED", bank: "BCA", reviewNote: "Nominal pada bukti transfer (Rp100.000) tidak sama dengan nominal pengajuan. Silakan ajukan ulang dengan bukti yang sesuai." },
];
const ADJUSTMENT = 50_000;

function totalSpent(sponsor: SponsorKey, today: string): number {
  return sponsorSeeds(sponsor).reduce((sum, seed) => sum + daysBetween(addDays(today, seed.start), -seed.start + 1, [seed], today).reduce((s, d) => s + d.spend, 0), 0);
}
function totalTopUp(sponsor: SponsorKey): number {
  return TOPUPS.filter(t => t.sponsor === sponsor && t.status === "APPROVED").reduce((s, t) => s + t.amount, 0);
}
function sponsorBalance(sponsor: SponsorKey, today: string): number {
  return totalTopUp(sponsor) - totalSpent(sponsor, today) + (sponsor === "cahaya" ? ADJUSTMENT : 0);
}

export function demoBalance(today: string = wibToday()): SponsorBalanceDto {
  const balance = sponsorBalance("cahaya", today);
  return {
    balance, totalTopUp: totalTopUp("cahaya"), totalSpent: totalSpent("cahaya", today), netAdjustment: ADJUSTMENT,
    estimatedClicksRemaining: Math.floor(balance / CPC), lowBalanceThreshold: 100_000, defaultCpcAmount: CPC, minTopUpAmount: 100_000,
    pendingTopUps: TOPUPS.filter(t => t.sponsor === "cahaya" && t.status === "PENDING").length,
    topUpAccount: { bankName: "Bank Contoh", accountNumber: "1234 5678 90", accountHolder: "PT Student Hub Indonesia" },
  };
}

function buildTopUp(t: TopUpSeed, today: string): TopUpDto {
  const date = addDays(today, -t.daysAgo);
  const reviewed = t.status === "APPROVED" || t.status === "REJECTED";
  return {
    id: t.id, sponsorId: SPONSORS[t.sponsor].id, amount: t.amount, transferDate: date, senderName: SPONSORS[t.sponsor].companyName, senderBank: t.bank, note: null,
    status: t.status, reviewNote: t.reviewNote ?? null, reviewedAt: reviewed ? atWib(date, 15) : null, proofFileId: `${DEMO_FILE_PREFIX}ads/${t.proof ?? "bukti-transfer.svg"}`, createdAt: atWib(date, 10, 12),
  };
}
export function demoTopUps(today: string = wibToday()): TopUpDto[] {
  return TOPUPS.filter(t => t.sponsor === "cahaya").map(t => buildTopUp(t, today)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function demoPlatformTopUps(status: TopUpDto["status"] | "ALL" = "PENDING", today: string = wibToday()): PlatformTopUpDto[] {
  return TOPUPS.filter(t => status === "ALL" || t.status === status).map(t => {
    const sponsor = SPONSORS[t.sponsor];
    return { ...buildTopUp(t, today), sponsor: { id: sponsor.id, companyName: sponsor.companyName, status: sponsor.status, balance: sponsorBalance(t.sponsor, today) }, duplicateProofOf: [] };
  });
}

interface LedgerSeed { readonly type: LedgerEntryDto["type"]; readonly amount: number; readonly note: string | null; readonly at: string; readonly adId: string | null; readonly topUpRequestId: string | null }

/** Ledger terbaru dulu: potongan klik hari ini, penyesuaian, lalu top-up (saldo setelahnya konsisten mundur). */
export function demoLedger(today: string = wibToday()): LedgerEntryDto[] {
  const clicks: LedgerSeed[] = Array.from({ length: 8 }, (_, i) => ({ type: "CLICK_CHARGE", amount: -CPC, note: null, at: atWib(today, 11 - Math.floor(i / 2), 50 - i * 5), adId: i % 3 === 0 ? "ad-tryout" : "ad-bimbel", topUpRequestId: null }));
  const rest: LedgerSeed[] = [
    { type: "ADJUSTMENT", amount: ADJUSTMENT, note: "Kompensasi gangguan penayangan 2 jam", at: atWib(addDays(today, -5), 16), adId: null, topUpRequestId: null },
    { type: "TOPUP", amount: 2_000_000, note: null, at: atWib(addDays(today, -20), 15), adId: null, topUpRequestId: "tu-cahaya-3" },
    { type: "TOPUP", amount: 3_000_000, note: null, at: atWib(addDays(today, -26), 15), adId: null, topUpRequestId: "tu-cahaya-2" },
  ];
  let after = sponsorBalance("cahaya", today);
  let seq = 900;
  return [...clicks, ...rest].map(entry => {
    const row: LedgerEntryDto = { id: `led-${seq}`, seq, type: entry.type, amount: entry.amount, balanceAfter: after, note: entry.note, topUpRequestId: entry.topUpRequestId, adId: entry.adId, createdAt: entry.at };
    after -= entry.amount;
    seq -= entry.type === "CLICK_CHARGE" ? 1 : 97;
    return row;
  });
}

export function demoSponsorProfile(today: string = wibToday()): SponsorDto {
  const s = SPONSORS.cahaya;
  return { id: s.id, companyName: s.companyName, contactName: "Rizky Pratama", contactEmail: s.email, contactPhone: "+62 812 3456 7890", address: "Jl. Pendidikan No. 12, Jakarta Pusat", status: s.status, statusReason: null, reviewedAt: atWib(addDays(today, -s.joinedDaysAgo + 1), 10), balance: sponsorBalance("cahaya", today), createdAt: atWib(addDays(today, -s.joinedDaysAgo), 9), updatedAt: atWib(addDays(today, -3), 9) };
}

export function demoPlatformSponsors(today: string = wibToday()): SponsorListItemDto[] {
  return (Object.keys(SPONSORS) as SponsorKey[]).map(key => {
    const s = SPONSORS[key];
    return { id: s.id, companyName: s.companyName, contactEmail: s.email, status: s.status, balance: key === "koperasi" ? 0 : sponsorBalance(key, today), pendingTopUps: TOPUPS.filter(t => t.sponsor === key && t.status === "PENDING").length, pendingAdReviews: AD_SEEDS.filter(a => a.sponsor === key && a.status === "PENDING_REVIEW").length, createdAt: atWib(addDays(today, -s.joinedDaysAgo), 9) };
  });
}

export function demoAdSettings(today: string = wibToday()): AdSettingsDto {
  return { defaultCpcAmount: CPC, minTopUpAmount: 100_000, topUpBankName: "Bank Contoh", topUpAccountNumber: "1234 5678 90", topUpAccountHolder: "PT Student Hub Indonesia", deepLinkSchemes: [], lowBalanceThreshold: 100_000, updatedAt: atWib(addDays(today, -30), 9) };
}

export const demoTargetSchools: readonly TargetSchool[] = [
  { id: "sc1", name: "SMA Cendekia Nusantara", provinceCode: "31", provinceName: "DKI Jakarta", cityCode: "31.71", cityName: "Kota Jakarta Pusat" },
  { id: "sc2", name: "SMP Harapan Bangsa", provinceCode: "32", provinceName: "Jawa Barat", cityCode: "32.73", cityName: "Kota Bandung" },
  { id: "sc3", name: "SMA Tunas Mandiri", provinceCode: "36", provinceName: "Banten", cityCode: "36.71", cityName: "Kota Tangerang" },
];

// ----------------------------------------------------------------------------- perutean jalur

const LIST_PATHS: Record<string, (today: string) => unknown> = {
  "/student/ads": () => demoServedAds(),
  "/sponsor/ads": demoSponsorAds,
  "/sponsor/profile": demoSponsorProfile,
  "/sponsor/balance": demoBalance,
  "/sponsor/ledger": demoLedger,
  "/sponsor/topups": demoTopUps,
  "/sponsor/targeting/schools": () => demoTargetSchools,
  "/sponsor/analytics/summary": today => demoAnalyticsSummary("7d", today),
  "/sponsor/analytics/timeseries": today => demoAnalyticsSeries("7d", today),
  "/sponsor/analytics/breakdown": today => demoAnalyticsBreakdown("device", "7d", today),
  "/sponsor/analytics/ads": today => demoAdPerformance("7d", today),
  "/platform/ads": today => demoReviewAds("PENDING_REVIEW", today),
  "/platform/topups": today => demoPlatformTopUps("PENDING", today),
  "/platform/sponsors": demoPlatformSponsors,
  "/platform/settings/ads": demoAdSettings,
};

/** Data demo jalur iklan/sponsor; `undefined` bila jalur bukan milik domain ini. */
export function demoAdsRows(path: string, today: string = wibToday()): unknown {
  return LIST_PATHS[path]?.(today);
}

/** Detail demo `/sponsor/ads/{id}`, `/platform/ads/{id}`, `/platform/topups/{id}`; `undefined` bila bukan jalur ini. */
export function demoAdsDetail(path: string, id: string, today: string = wibToday()): object | null | undefined {
  if (path === "/sponsor/ads") return demoSponsorAd(id, today);
  if (path === "/platform/ads") return demoReviewAd(id, today);
  if (path === "/platform/topups") return demoPlatformTopUps("ALL", today).find(t => t.id === id) ?? null;
  return undefined;
}
