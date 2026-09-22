/**
 * Penayangan slider siswa: kandidat (disetujui, dalam jadwal, sponsor disetujui, saldo >= CPC, target cocok),
 * batas 5 & 2 per sponsor, token terverifikasi & terikat siswa, sekolah nonaktif / siswa lulus.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as pauseRoute } from "@/app/api/v1/sponsor/ads/[id]/pause/route";
import { verifyAdToken } from "@/lib/ads/token";
import { getEnv } from "@/lib/env";
import { setStorageDriver } from "@/lib/storage/driver";
import { disconnect, prisma } from "../helpers/db";
import { createSchool } from "../helpers/factories";
import { callRoute } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import { fund, isolateServing, liveAd, resetEventState, schoolTarget, serve, sponsorFx, studentFx, superFx } from "./fixtures";

let storage: TempStorage;
let superToken = "";
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  superToken = (await superFx()).token;
  await isolateServing();
});
beforeEach(resetEventState);
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const servedIds = async (token: string): Promise<string[]> => (await serve(token)).body?.data.ads.map((a) => a.adId) ?? [];

test("target provinsi/kota/sekolah cocok hanya untuk sekolah yang sesuai", async () => {
  const sp = await sponsorFx();
  await fund(sp.sponsorId, 100_000);
  const bandung = await createSchool({ provinceCode: "32", cityCode: "32.73" });
  const jakarta = await createSchool({ provinceCode: "31", cityCode: "31.71" });
  const [sBandung, sJakarta] = [await studentFx(bandung), await studentFx(jakarta)];
  await isolateServing();
  const province = await liveAd(sp, superToken, { targetScope: "PROVINCE", targets: { provinceCodes: ["31"] } });
  const city = await liveAd(sp, superToken, { targetScope: "CITY", targets: { cityCodes: ["32.73"] } });
  const school = await liveAd(await sponsorWithFunds(), superToken, schoolTarget(jakarta.id));
  const jakartaIds = await servedIds(sJakarta.token);
  const bandungIds = await servedIds(sBandung.token);
  assert.ok(jakartaIds.includes(province.id) && jakartaIds.includes(school.id) && !jakartaIds.includes(city.id));
  assert.ok(bandungIds.includes(city.id) && !bandungIds.includes(province.id) && !bandungIds.includes(school.id));
  await prisma.ad.updateMany({ where: { id: { in: [province.id, city.id] } }, data: { status: "PAUSED" } });
});

async function sponsorWithFunds(amount = 100_000) {
  const sp = await sponsorFx();
  await fund(sp.sponsorId, amount);
  return sp;
}

test("dikecualikan: sponsor ditangguhkan, saldo < CPC, iklan dijeda, belum mulai, sudah berakhir", async () => {
  const school = await createSchool();
  const student = await studentFx(school);
  const target = schoolTarget(school.id);
  const ok = await liveAd(await sponsorWithFunds(), superToken, target);
  const suspendedSp = await sponsorWithFunds();
  const suspended = await liveAd(suspendedSp, superToken, target);
  await prisma.sponsor.update({ where: { id: suspendedSp.sponsorId }, data: { status: "SUSPENDED" } });
  const broke = await liveAd(await sponsorWithFunds(499), superToken, target);
  const pausedSp = await sponsorWithFunds();
  const paused = await liveAd(pausedSp, superToken, target);
  await callRoute(pauseRoute, { method: "POST", url: `/api/v1/sponsor/ads/${paused.id}/pause`, params: { id: paused.id }, bearer: pausedSp.token });
  const future = await liveAd(await sponsorWithFunds(), superToken, { ...target, startAt: new Date(Date.now() + 86_400_000).toISOString() });
  const ended = await liveAd(await sponsorWithFunds(), superToken, target);
  await prisma.ad.update({ where: { id: ended.id }, data: { endAt: new Date(Date.now() - 1000), startAt: new Date(Date.now() - 7_200_000) } });
  assert.deepEqual(await servedIds(student.token), [ok.id]);
  assert.ok([suspended, broke, future].every((a) => a.id));
});

test("maks 5 iklan & maks 2 per sponsor; token terverifikasi terikat siswa & sekolah; urutan stabil dalam satu jam", async () => {
  const school = await createSchool();
  const student = await studentFx(school);
  const target = schoolTarget(school.id);
  const big = await sponsorWithFunds();
  for (let i = 0; i < 4; i += 1) await liveAd(big, superToken, target);
  for (let i = 0; i < 4; i += 1) await liveAd(await sponsorWithFunds(), superToken, target);
  const res = await serve(student.token);
  const ads = res.body?.data.ads ?? [];
  assert.equal(ads.length, 5);
  const bigAds = await prisma.ad.count({ where: { id: { in: ads.map((a) => a.adId) }, sponsorId: big.sponsorId } });
  assert.ok(bigAds <= 2);
  for (const ad of ads) {
    const claims = await verifyAdToken(ad.token, getEnv().AD_EVENT_SECRET, new Date());
    assert.deepEqual([claims?.adId, claims?.userId, claims?.schoolId], [ad.adId, student.user.id, school.id]);
    assert.match(ad.imageUrl, /\/ad-banner\//);
  }
  assert.deepEqual(await servedIds(student.token), ads.map((a) => a.adId));
  assert.equal(res.body?.data.refreshAfterSeconds, 1800);
});

test("sekolah nonaktif -> sesi ditolak gerbang auth (401); siswa lulus / sponsor -> 403", async () => {
  const school = await createSchool();
  const student = await studentFx(school);
  await liveAd(await sponsorWithFunds(), superToken, schoolTarget(school.id));
  await prisma.school.update({ where: { id: school.id }, data: { isActive: false } });
  assert.equal((await serve(student.token)).status, 401);
  const graduated = await studentFx(await createSchool(), { status: "GRADUATED" });
  const denied = await serve(graduated.token);
  assert.equal(denied.status, 403);
  assert.equal(denied.body?.error?.code, "STUDENT_NOT_ACTIVE");
  assert.equal((await serve((await sponsorFx()).token)).status, 403);
});
