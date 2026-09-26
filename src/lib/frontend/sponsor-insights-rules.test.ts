import { test } from "node:test";
import assert from "node:assert/strict";
import type { AdDto, AdPerformanceDto, AnalyticsDay, AnalyticsSeries, AnalyticsSummary, SponsorBalanceDto } from "./ad-types";
import {
  accountNotice, adOptionLabel, adTone, tailCrowdedDates, balanceAlert, breakdownBars, compareLabel, ctrPercent, ctrValues, demoInsights, firstName, formatCtr,
  formatMetric, insightsPath, liveByClicks, longDate, metricValues, rangeLabel, runwayLabel, sortPerformance, statusSummary, trendFooter, trendSummary, wibShortDate,
} from "./sponsor-insights-rules";

const NBSP = " ";
const day = (date: string, impressions: number, clicks: number, chargedClicks = clicks, spend = chargedClicks * 500): AnalyticsDay => ({ date, impressions, clicks, uniqueClicks: clicks, chargedClicks, spend });

test("firstName mengambil nama depan untuk sapaan", () => {
  assert.equal(firstName("Rizky Pratama"), "Rizky");
  assert.equal(firstName("  Dimas  "), "Dimas");
  assert.equal(firstName(""), "");
});

test("longDate menulis tanggal hari ini menurut WIB", () => {
  assert.equal(longDate(new Date("2026-09-26T03:00:00Z")), "Sabtu, 26 September 2026");
  assert.equal(longDate(new Date("2026-09-25T18:30:00Z")), "Sabtu, 26 September 2026", "01.30 WIB sudah tanggal 26");
  assert.equal(wibShortDate("2026-11-04T17:00:00.000Z"), "5 Nov", "00.00 WIB tanggal 5");
  assert.equal(wibShortDate("bukan tanggal"), "—");
});

test("rangeLabel meringkas rentang periode", () => {
  assert.equal(rangeLabel({ from: "2026-09-20", to: "2026-09-26" }), "20–26 Sep 2026");
  assert.equal(rangeLabel({ from: "2026-08-28", to: "2026-09-26" }), "28 Agu – 26 Sep 2026");
  assert.equal(rangeLabel({ from: "2025-12-28", to: "2026-01-03" }), "28 Des 2025 – 3 Jan 2026");
  assert.equal(compareLabel("7d"), "vs 7 hari sebelumnya");
  assert.equal(compareLabel("30d"), "vs 30 hari sebelumnya");
});

test("CTR dihitung dalam persen dua desimal dan ditulis satu desimal", () => {
  assert.equal(ctrPercent(23, 560), 4.11);
  assert.equal(ctrPercent(0, 0), null);
  assert.equal(formatCtr(4.11), "4,1%");
  assert.equal(formatCtr(0), "0,0%");
  assert.equal(formatCtr(null), "—");
});

test("formatMetric: biaya dalam rupiah, lainnya angka lengkap", () => {
  assert.equal(formatMetric("spend", 45_500), `Rp${NBSP}45.500`);
  assert.equal(formatMetric("impressions", 12_840), "12.840");
  assert.equal(formatMetric("clicks", 7), "7");
});

test("metricValues & ctrValues membaca deret harian", () => {
  const days = [day("2026-09-25", 500, 20), day("2026-09-26", 0, 0)];
  assert.deepEqual(metricValues(days, "impressions"), [500, 0]);
  assert.deepEqual(metricValues(days, "spend"), [10_000, 0]);
  assert.deepEqual(ctrValues(days), [4], "hari tanpa tayangan dilewati");
});

test("trendFooter menampilkan metrik lain pada hari itu", () => {
  const d = day("2026-09-25", 560, 23, 21);
  assert.equal(trendFooter(d, "impressions"), "Klik 23 · CTR 4,1%");
  assert.equal(trendFooter(d, "clicks"), "Tayangan 560 · CTR 4,1%");
  assert.equal(trendFooter(d, "spend"), "21 klik ditagih dari 23 klik");
});

test("trendSummary: total, rata-rata per hari, dan hari tertinggi", () => {
  assert.deepEqual(trendSummary([10, 30, 20]), { total: 60, average: 20, peak: 1 });
  assert.deepEqual(trendSummary([0, 0]), { total: 0, average: 0, peak: null });
  assert.deepEqual(trendSummary([]), { total: 0, average: 0, peak: null });
});

test("tailCrowdedDates: tanggal < 64px dari label terakhir dikosongkan, tanpa menebak langkah label kit", () => {
  const month = Array.from({ length: 30 }, (_, i) => `d${i}`);
  assert.deepEqual([...tailCrowdedDates(month, 268)], ["d23", "d24", "d25", "d26", "d27", "d28"], "HP 390px: 9,2px per hari -> 7 hari terakhir");
  assert.deepEqual([...tailCrowdedDates(month, 1002)], ["d28"], "desktop lebar: hanya tetangga terdekat");
  assert.equal(tailCrowdedDates(month, 1002).has("d29"), false, "label terakhir selalu tampil");
  assert.deepEqual([...tailCrowdedDates(["a"], 268)], [], "satu titik");
  assert.deepEqual([...tailCrowdedDates(month, 0)], [], "lebar belum terukur");
});

test("runwayLabel memperkirakan umur saldo dari laju biaya", () => {
  assert.equal(runwayLabel(600_000, 70_000, 7), "Cukup untuk ± 60 hari pada laju 7 hari terakhir");
  assert.equal(runwayLabel(5_000, 70_000, 7), "Kurang dari sehari pada laju 7 hari terakhir");
  assert.equal(runwayLabel(50_000_000, 7_000, 7), "Cukup untuk lebih dari 3 bulan pada laju 7 hari terakhir");
  assert.equal(runwayLabel(1_000_000, 0, 7), null, "tanpa biaya -> tidak ada perkiraan");
});

const balanceOf = (balance: number): SponsorBalanceDto => ({ balance, totalTopUp: 0, totalSpent: 0, netAdjustment: 0, estimatedClicksRemaining: Math.floor(balance / 500), lowBalanceThreshold: 100_000, defaultCpcAmount: 500, minTopUpAmount: 100_000, pendingTopUps: 0, topUpAccount: null });

test("balanceAlert: habis bila kurang dari satu klik, menipis di bawah ambang", () => {
  assert.equal(balanceAlert(balanceOf(400)), "empty");
  assert.equal(balanceAlert(balanceOf(99_500)), "low");
  assert.equal(balanceAlert(balanceOf(100_000)), null);
});

test("accountNotice hanya untuk akun yang belum/tidak aktif", () => {
  assert.equal(accountNotice("APPROVED", null), null);
  assert.equal(accountNotice("PENDING", null)?.title, "Akun sedang ditinjau");
  const suspended = accountNotice("SUSPENDED", "Dokumen perusahaan kedaluwarsa.");
  assert.equal(suspended?.tone, "warning");
  assert.match(suspended?.text ?? "", /Dokumen perusahaan kedaluwarsa\./);
});

test("adTone memberi warna status iklan", () => {
  assert.equal(adTone("LIVE"), "green");
  assert.equal(adTone("PENDING_REVIEW"), "amber");
  assert.equal(adTone("SCHEDULED"), "amber");
  assert.equal(adTone("NO_BALANCE"), "red");
  assert.equal(adTone("REJECTED"), "red");
  assert.equal(adTone("DRAFT"), "neutral");
  assert.equal(adTone("ENDED"), "neutral");
});

const row = (adId: string, title: string, impressions: number, clicks: number, ctr: number | null, spend: number): AdPerformanceDto => ({
  adId, title, imageUrl: null, status: "APPROVED", displayStatus: "LIVE", isActive: true, startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-10-01T00:00:00.000Z", impressions, clicks, uniqueClicks: clicks, ctr, spend,
});

test("sortPerformance mengikuti urutan server (menurun, seri -> klik, tayangan, judul)", () => {
  const rows = [row("a", "Beta", 100, 5, 5, 2_500), row("b", "Alfa", 400, 5, 1.25, 2_000), row("c", "Gama", 0, 0, null, 0)];
  assert.deepEqual(sortPerformance(rows, "clicks").map(r => r.adId), ["b", "a", "c"]);
  assert.deepEqual(sortPerformance(rows, "ctr").map(r => r.adId), ["a", "b", "c"]);
  assert.deepEqual(sortPerformance(rows, "spend").map(r => r.adId), ["a", "b", "c"]);
  assert.deepEqual(sortPerformance(rows, "impressions").map(r => r.adId), ["b", "a", "c"]);
});

test("breakdownBars: nilai = klik, rincian = porsi", () => {
  assert.deepEqual(breakdownBars([{ key: "MOBILE", label: "Ponsel", clicks: 120, sharePct: 81.4 }]), [{ key: "MOBILE", label: "Ponsel", value: 120, detail: "81,4% dari total klik" }]);
});

test("insightsPath menyusun query tanpa parameter kosong", () => {
  assert.equal(insightsPath("/sponsor/analytics/summary", { preset: "7d", adId: "" }), "/sponsor/analytics/summary?preset=7d");
  assert.equal(insightsPath("/sponsor/analytics/ads", { preset: "30d", sort: "ctr", adId: "ad 1" }), "/sponsor/analytics/ads?preset=30d&sort=ctr&adId=ad%201");
  assert.equal(insightsPath("/sponsor/balance", {}), "/sponsor/balance");
});

const adOf = (displayStatus: AdDto["displayStatus"], title = "Iklan"): Pick<AdDto, "displayStatus" | "title"> => ({ displayStatus, title });

test("statusSummary & adOptionLabel meringkas status kampanye", () => {
  assert.equal(statusSummary([adOf("LIVE"), adOf("DRAFT"), adOf("LIVE"), adOf("PENDING_REVIEW"), adOf("ARCHIVED")]), "2 aktif · 1 menunggu tinjauan · 1 draf");
  assert.equal(statusSummary([]), "");
  assert.equal(adOptionLabel(adOf("LIVE", "Tryout")), "Tryout");
  assert.equal(adOptionLabel(adOf("DRAFT", "Kelas coding")), "Kelas coding (Draf)");
});

test("liveByClicks hanya iklan tayang, urut klik 7 hari terbanyak", () => {
  const ads = [{ id: "a", title: "A", displayStatus: "LIVE" as const }, { id: "b", title: "B", displayStatus: "DRAFT" as const }, { id: "c", title: "C", displayStatus: "LIVE" as const }];
  assert.deepEqual(liveByClicks(ads, [{ adId: "a", clicks: 3 }, { adId: "c", clicks: 9 }, { adId: "b", clicks: 50 }]).map(a => a.id), ["c", "a"]);
  assert.deepEqual(liveByClicks(ads, []).map(a => a.id), ["a", "c"], "tanpa data -> urut judul");
});

test("demoInsights melayani jalur analitik sponsor sesuai parameter", () => {
  const today = "2026-09-26";
  const summary = demoInsights("/sponsor/analytics/summary?preset=30d", today) as AnalyticsSummary;
  assert.equal(summary.period.days, 30);
  const series = demoInsights("/sponsor/analytics/timeseries?preset=7d&adId=ad-tryout", today) as AnalyticsSeries;
  assert.equal(series.days.length, 7);
  const table = demoInsights("/sponsor/analytics/ads?preset=7d&sort=impressions&limit=1", today) as AdPerformanceDto[];
  assert.equal(table.length, 1);
  const byImpressions = demoInsights("/sponsor/analytics/ads?preset=7d&sort=impressions", today) as AdPerformanceDto[];
  assert.ok(byImpressions.every((r, i) => i === 0 || (byImpressions[i - 1]?.impressions ?? 0) >= r.impressions));
  const empty = demoInsights("/sponsor/analytics/breakdown?dimension=province&preset=7d&adId=ad-beasiswa", today) as { items: unknown[] };
  assert.deepEqual(empty.items, [], "iklan tanpa klik -> sebaran kosong");
  assert.ok(Array.isArray(demoInsights("/sponsor/ads?limit=100", today)));
  assert.equal(demoInsights("/school/students", today), undefined);
});
