import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEMO_SPONSOR_ID, demoAdPerformance, demoAnalyticsBreakdown, demoAnalyticsSeries, demoAnalyticsSummary, demoBalance, demoLedger, demoPlatformTopUps, demoReviewAds, demoServedAds, demoSponsorAds, demoTopUps, wibToday } from "./demo-ads";
import { demoRows, demoStudents } from "./demo";
import { demoPersona } from "./demo-personas";

const TODAY = "2026-09-26";
const publicFile = (src: string) => existsSync(join(process.cwd(), "public", src.replace(/^\//, "")));

test("iklan tayang untuk siswa: maks 5, maks 2 per sponsor, semua gambarnya ada", () => {
  const { ads, refreshAfterSeconds } = demoServedAds();
  assert.ok(ads.length > 0 && ads.length <= 5);
  assert.equal(refreshAfterSeconds, 1800);
  const perSponsor = new Map<string, number>();
  for (const ad of ads) perSponsor.set(ad.sponsorName, (perSponsor.get(ad.sponsorName) ?? 0) + 1);
  assert.ok([...perSponsor.values()].every(n => n <= 2));
  assert.equal(new Set(ads.map(a => a.token)).size, ads.length, "token unik");
  for (const ad of ads) assert.ok(publicFile(ad.imageUrl), `banner ${ad.imageUrl} ada`);
  assert.ok(ads.every(a => a.targetUrl.startsWith("https://")));
});

test("iklan siswa bersifat umum: tidak memuat data siswa mana pun", () => {
  const text = JSON.stringify(demoRows("/student/ads", demoPersona("STUDENT")));
  for (const s of demoStudents) assert.ok(!text.includes(String(s.name)) && !text.includes(String(s.nisn)));
});

test("kampanye sponsor hanya milik sponsor demo, dengan status yang beragam", () => {
  const ads = demoSponsorAds(TODAY);
  assert.ok(ads.every(a => a.sponsorId === DEMO_SPONSOR_ID));
  const statuses = new Set(ads.map(a => a.displayStatus));
  for (const s of ["LIVE", "PENDING_REVIEW", "DRAFT"]) assert.ok(statuses.has(s as never), `ada ${s}`);
  for (const ad of ads) assert.equal(ad.imageUrl === null, !["APPROVED", "PAUSED"].includes(ad.status), "salinan publik hanya untuk yang disetujui/dijeda");
});

test("saldo konsisten: top-up - terpakai + penyesuaian; ledger mundur konsisten", () => {
  const b = demoBalance(TODAY);
  assert.equal(b.balance, b.totalTopUp - b.totalSpent + b.netAdjustment);
  assert.equal(b.estimatedClicksRemaining, Math.floor(b.balance / b.defaultCpcAmount));
  const ledger = demoLedger(TODAY);
  assert.equal(ledger[0]!.balanceAfter, b.balance);
  for (let i = 0; i + 1 < ledger.length; i++) assert.equal(ledger[i + 1]!.balanceAfter, ledger[i]!.balanceAfter - ledger[i]!.amount);
  assert.equal(b.pendingTopUps, demoTopUps(TODAY).filter(t => t.status === "PENDING").length);
});

test("analitik: KPI = jumlah deret harian; CTR & persentase sebaran konsisten", () => {
  for (const preset of ["7d", "30d"] as const) {
    const series = demoAnalyticsSeries(preset, TODAY);
    const summary = demoAnalyticsSummary(preset, TODAY);
    assert.equal(series.days.length, preset === "7d" ? 7 : 30);
    assert.equal(series.days.at(-1)!.date, TODAY);
    assert.equal(summary.kpis.impressions.value, series.days.reduce((s, d) => s + d.impressions, 0));
    assert.equal(summary.kpis.spend.value, series.days.reduce((s, d) => s + d.spend, 0));
    const ctr = summary.kpis.ctr.value;
    assert.ok(ctr !== null && Math.abs(ctr - (summary.kpis.clicks.value / summary.kpis.impressions.value) * 100) < 0.01);
  }
  const breakdown = demoAnalyticsBreakdown("device", "7d", TODAY);
  assert.ok(Math.abs(breakdown.items.reduce((s, i) => s + i.sharePct, 0) - 100) < 0.01);
  const perAd = demoAdPerformance("7d", TODAY);
  assert.ok(perAd.every((row, i) => i === 0 || perAd[i - 1]!.clicks >= row.clicks), "urut klik terbanyak");
});

test("antrean super admin: iklan menunggu tinjauan terlama dulu; top-up menunggu saja secara bawaan", () => {
  const queue = demoReviewAds("PENDING_REVIEW", TODAY);
  assert.ok(queue.length >= 2 && queue.every(a => a.status === "PENDING_REVIEW"));
  assert.ok(queue.every((a, i) => i === 0 || (queue[i - 1]!.submittedAt ?? "") <= (a.submittedAt ?? "")));
  assert.ok(demoPlatformTopUps("PENDING", TODAY).every(t => t.status === "PENDING"));
});

test("perutean demo: jalur pengaturan iklan mengembalikan objek pengaturan, bukan daftar iklan", () => {
  const settings = demoRows("/platform/settings/ads") as { defaultCpcAmount?: number };
  assert.equal(settings.defaultCpcAmount, 500);
  assert.ok(Array.isArray((demoRows("/student/ads") as { ads: unknown[] }).ads));
  assert.match(wibToday(new Date("2026-09-25T18:30:00Z")), /^2026-09-26$/, "tengah malam WIB sudah berganti hari");
});
