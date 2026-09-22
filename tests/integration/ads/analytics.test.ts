/**
 * Analitik sponsor dari data tersemai di dua periode (7 hari ini vs 7 hari sebelumnya): KPI + % perubahan,
 * klik unik COUNT DISTINCT, deret harian terisi nol, breakdown perangkat & provinsi, tabel per iklan (top 3),
 * cakupan super admin & IDOR.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { DeviceType } from "@prisma/client";
import { GET as breakdownRoute } from "@/app/api/v1/sponsor/analytics/breakdown/route";
import { GET as perAdRoute } from "@/app/api/v1/sponsor/analytics/ads/route";
import { GET as summaryRoute } from "@/app/api/v1/sponsor/analytics/summary/route";
import { GET as seriesRoute } from "@/app/api/v1/sponsor/analytics/timeseries/route";
import { setStorageDriver } from "@/lib/storage/driver";
import { addDays, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { createSchool } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import { fund, liveAd, schoolTarget, sponsorFx, studentFx, superFx, todayWib, type AdBody, type SponsorFx } from "./fixtures";

let storage: TempStorage;
let superToken = "";
let sp: SponsorFx;
let adA: AdBody;
let adB: AdBody;
const T = todayWib();

async function seedClicks(): Promise<void> {
  const [bandung, jakarta] = [await createSchool({ provinceCode: "32", cityCode: "32.73" }), await createSchool({ provinceCode: "31", cityCode: "31.71" })];
  const [u1, u2, u3, u4, u5] = [await studentFx(bandung), await studentFx(jakarta), await studentFx(bandung), await studentFx(bandung), await studentFx(bandung)];
  const row = (s: typeof u1, day: string, deviceType: DeviceType) => ({
    adId: adA.id, sponsorId: sp.sponsorId, userId: s.user.id, schoolId: s.school.id, provinceCode: s.school.provinceCode, cityCode: s.school.cityCode,
    deviceType, date: toDbDate(day), billing: "SUSPECT" as const,
  });
  await prisma.adClick.createMany({
    data: [
      row(u1, addDays(T, -1), "MOBILE"), row(u2, addDays(T, -1), "TABLET"), row(u3, addDays(T, -1), "MOBILE"), row(u1, addDays(T, -1), "MOBILE"),
      row(u1, addDays(T, -2), "MOBILE"), row(u4, addDays(T, -8), "MOBILE"), row(u5, addDays(T, -8), "MOBILE"),
    ],
  });
  const stat = (adId: string, day: string, v: [number, number, number, number]) => ({
    adId, sponsorId: sp.sponsorId, date: toDbDate(day), impressions: v[0], clicks: v[1], chargedClicks: v[2], spend: v[3], uniqueClicks: 0,
  });
  await prisma.adDailyStat.createMany({
    data: [stat(adA.id, addDays(T, -1), [10, 4, 2, 1000]), stat(adA.id, addDays(T, -2), [5, 1, 1, 500]), stat(adA.id, addDays(T, -8), [10, 2, 2, 1000]), stat(adB.id, addDays(T, -1), [5, 0, 0, 0])],
  });
}

before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  superToken = (await superFx()).token;
  sp = await sponsorFx();
  await fund(sp.sponsorId, 50_000);
  const school = await createSchool();
  adA = await liveAd(sp, superToken, schoolTarget(school.id));
  adB = await liveAd(sp, superToken, { ...schoolTarget(school.id), title: "Promo B" });
  await seedClicks();
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

type Kpi = { value: number | null; previous: number | null; changePct: number | null };

test("KPI 7 hari + % perubahan vs 7 hari sebelumnya; klik unik distinct lintas hari", async () => {
  const res = await callRoute<Envelope<{ period: { from: string; prevTo: string; days: number }; kpis: Record<string, Kpi> }>>(summaryRoute, {
    method: "GET", url: "/api/v1/sponsor/analytics/summary?preset=7d", bearer: sp.token,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const period = res.body?.data.period;
  const kpis: Record<string, Kpi> = res.body?.data.kpis ?? {};
  assert.deepEqual([period?.from, period?.prevTo, period?.days], [addDays(T, -6), addDays(T, -7), 7]);
  assert.deepEqual(kpis.impressions, { value: 20, previous: 10, changePct: 100 });
  assert.deepEqual(kpis.clicks, { value: 5, previous: 2, changePct: 150 });
  assert.deepEqual(kpis.uniqueClicks, { value: 3, previous: 2, changePct: 50 });
  assert.deepEqual(kpis.ctr, { value: 25, previous: 20, changePct: 25 });
  assert.deepEqual(kpis.spend, { value: 1500, previous: 1000, changePct: 50 });
  const onlyB = await callRoute<Envelope<{ kpis: Record<string, Kpi> }>>(summaryRoute, { method: "GET", url: `/api/v1/sponsor/analytics/summary?adId=${adB.id}`, bearer: sp.token });
  assert.deepEqual(onlyB.body?.data.kpis.clicks, { value: 0, previous: 0, changePct: 0 });
  assert.deepEqual(onlyB.body?.data.kpis.impressions, { value: 5, previous: 0, changePct: null });
});

test("deret harian terisi nol dengan klik unik per hari", async () => {
  const res = await callRoute<Envelope<{ days: Array<{ date: string; clicks: number; uniqueClicks: number; impressions: number }> }>>(seriesRoute, {
    method: "GET", url: `/api/v1/sponsor/analytics/timeseries?from=${addDays(T, -3)}&to=${T}`, bearer: sp.token,
  });
  assert.deepEqual(res.body?.data.days.map((d) => [d.date, d.impressions, d.clicks, d.uniqueClicks]), [
    [addDays(T, -3), 0, 0, 0], [addDays(T, -2), 5, 1, 1], [addDays(T, -1), 15, 4, 3], [T, 0, 0, 0],
  ]);
});

test("breakdown perangkat & provinsi berlabel, pangsa berjumlah 100", async () => {
  const device = await callRoute<Envelope<{ items: Array<{ key: string; label: string; clicks: number; sharePct: number }> }>>(breakdownRoute, {
    method: "GET", url: "/api/v1/sponsor/analytics/breakdown?dimension=device", bearer: sp.token,
  });
  assert.deepEqual(device.body?.data.items.map((i) => [i.key, i.label, i.clicks, i.sharePct]), [["MOBILE", "Mobile", 4, 80], ["TABLET", "Tablet", 1, 20]]);
  const province = await callRoute<Envelope<{ items: Array<{ key: string; label: string; clicks: number }> }>>(breakdownRoute, {
    method: "GET", url: "/api/v1/sponsor/analytics/breakdown?dimension=province&preset=30d", bearer: sp.token,
  });
  const byKey = new Map(province.body?.data.items.map((i) => [i.key, i]));
  assert.equal(byKey.get("32")?.clicks, 6);
  assert.equal(byKey.get("31")?.clicks, 1);
  assert.ok((byKey.get("32")?.label.length ?? 0) > 2);
});

test("tabel per iklan: urut klik, top 1, baris nol ikut; status tampilan", async () => {
  const res = await callRoute<Envelope<Array<{ adId: string; clicks: number; ctr: number | null; uniqueClicks: number; isActive: boolean }>>>(perAdRoute, {
    method: "GET", url: "/api/v1/sponsor/analytics/ads?sort=clicks", bearer: sp.token,
  });
  assert.deepEqual(res.body?.data.map((r) => [r.adId, r.clicks, r.ctr, r.uniqueClicks]), [[adA.id, 5, 33.33, 3], [adB.id, 0, 0, 0]]);
  assert.ok(res.body?.data.every((r) => r.isActive));
  const top = await callRoute<Envelope<unknown[]>>(perAdRoute, { method: "GET", url: "/api/v1/sponsor/analytics/ads?sort=impressions&limit=1", bearer: sp.token });
  assert.equal(top.body?.data.length, 1);
  assert.equal(top.body?.meta?.total, 2);
});

test("cakupan: super admin wajib sponsorId (400), dengan sponsorId 200; iklan sponsor lain 404; rentang tidak valid 400", async () => {
  const noScope = await callRoute<Envelope>(summaryRoute, { method: "GET", url: "/api/v1/sponsor/analytics/summary", bearer: superToken });
  assert.equal(noScope.body?.error?.code, "SPONSOR_ID_REQUIRED");
  const scoped = await callRoute<Envelope<{ kpis: Record<string, Kpi> }>>(summaryRoute, { method: "GET", url: `/api/v1/sponsor/analytics/summary?sponsorId=${sp.sponsorId}`, bearer: superToken });
  assert.equal(scoped.body?.data.kpis.clicks?.value, 5);
  const unknownSponsor = await callRoute<Envelope>(summaryRoute, { method: "GET", url: "/api/v1/sponsor/analytics/summary?sponsorId=tidak-ada", bearer: superToken });
  assert.equal(unknownSponsor.status, 404);
  const other = await sponsorFx();
  const idor = await callRoute<Envelope>(summaryRoute, { method: "GET", url: `/api/v1/sponsor/analytics/summary?adId=${adA.id}`, bearer: other.token });
  assert.equal(idor.body?.error?.code, "AD_NOT_FOUND");
  const ignored = await callRoute<Envelope<{ kpis: Record<string, Kpi> }>>(summaryRoute, { method: "GET", url: `/api/v1/sponsor/analytics/summary?sponsorId=${sp.sponsorId}`, bearer: other.token });
  assert.equal(ignored.body?.data.kpis.clicks?.value, 0, "sponsorId di query diabaikan untuk sponsor");
  const range = await callRoute<Envelope>(summaryRoute, { method: "GET", url: `/api/v1/sponsor/analytics/summary?from=${addDays(T, -100)}&to=${T}`, bearer: sp.token });
  assert.equal(range.status, 400);
  assert.equal(range.body?.error?.code, "ANALYTICS_RANGE_INVALID");
  const suspended = await sponsorFx("SUSPENDED");
  assert.equal((await callRoute(summaryRoute, { method: "GET", url: "/api/v1/sponsor/analytics/summary", bearer: suspended.token })).status, 200);
});
