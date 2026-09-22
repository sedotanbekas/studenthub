/**
 * Impresi & klik: dedupe impresi, penagihan (maks 1 per siswa/iklan/hari WIB), SUSPECT, AD_NOT_LIVE, token
 * palsu/siswa lain, 20 klik paralel tidak pernah overspend (saldo == ledger), klik ganda paralel siswa sama,
 * notifikasi saldo menipis sekali per penurunan, batas laju klik.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as pauseRoute } from "@/app/api/v1/sponsor/ads/[id]/pause/route";
import { recordClick } from "@/lib/ads/event-service";
import { getImpressionStore } from "@/lib/ads/impression-store";
import { signAdToken } from "@/lib/ads/token";
import type { ActionContext } from "@/lib/auth/principal";
import { getEnv } from "@/lib/env";
import { setStorageDriver } from "@/lib/storage/driver";
import { toDbDate, wibDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { createSchool } from "../helpers/factories";
import { callRoute } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  click, fund, impress, isolateServing, ledgerInvariant, liveAd, resetEventState, schoolTarget, servedTokenFor, sponsorFx, studentFx,
  superFx, viewAndClick, type AdBody, type SponsorFx, type StudentFx,
} from "./fixtures";

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

interface Setup {
  readonly sp: SponsorFx;
  readonly ad: AdBody;
  readonly school: Awaited<ReturnType<typeof createSchool>>;
}

async function setup(balance: number): Promise<Setup> {
  const sp = await sponsorFx();
  if (balance > 0) await fund(sp.sponsorId, balance);
  const school = await createSchool();
  const ad = await liveAd(sp, superToken, schoolTarget(school.id));
  return { sp, ad, school };
}

const billingsOf = async (adId: string) => (await prisma.adClick.findMany({ where: { adId }, select: { billing: true }, orderBy: { createdAt: "asc" } })).map((c) => c.billing);
const statOf = (adId: string) => prisma.adDailyStat.findFirst({ where: { adId, date: toDbDate(wibDate(new Date())) } });

test("impresi: dihitung sekali per 30 menit; token siswa lain & token palsu ditolak; rollup bertambah", async () => {
  const { ad, school } = await setup(10_000);
  const [s1, s2] = [await studentFx(school), await studentFx(school)];
  const t1 = await servedTokenFor(s1, ad.id);
  const first = await impress(s1.token, [t1, t1]);
  assert.deepEqual(first.body?.data, { accepted: 1, duplicate: 1, rejected: 0 });
  const again = await impress(s1.token, [t1]);
  assert.deepEqual(again.body?.data, { accepted: 0, duplicate: 1, rejected: 0 });
  const stolen = await impress(s2.token, [t1, `${t1.slice(0, -4)}AAAA`]);
  assert.deepEqual(stolen.body?.data, { accepted: 0, duplicate: 0, rejected: 2 });
  assert.equal((await impress(s1.token, [])).status, 400);
  assert.equal((await statOf(ad.id))?.impressions, 1);
});

test("klik pertama ditagih: ledger seq + balanceAfter, rollup, respons tanpa info tagihan; klik kedua hari sama DUPLICATE", async () => {
  const { sp, ad, school } = await setup(10_000);
  const student = await studentFx(school);
  const res = await viewAndClick(student, ad.id, "TABLET");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body?.data, { targetUrl: ad.targetUrl, linkType: "EXTERNAL_URL" });
  const entry = await prisma.sponsorLedgerEntry.findFirstOrThrow({ where: { sponsorId: sp.sponsorId, type: "CLICK_CHARGE" } });
  assert.deepEqual([entry.seq, entry.amount, entry.balanceAfter], [2, -500, 9_500]);
  const second = await viewAndClick(student, ad.id);
  assert.equal(second.body?.data.targetUrl, ad.targetUrl);
  assert.deepEqual(await billingsOf(ad.id), ["CHARGED", "DUPLICATE"]);
  const stat = await statOf(ad.id);
  assert.deepEqual([stat?.clicks, stat?.uniqueClicks, stat?.chargedClicks, stat?.spend], [2, 1, 1, 500]);
  const device = await prisma.adClick.findFirstOrThrow({ where: { adId: ad.id, billing: "CHARGED" }, select: { deviceType: true, provinceCode: true } });
  assert.deepEqual(device, { deviceType: "TABLET", provinceCode: school.provinceCode });
  assert.deepEqual(await ledgerInvariant(sp.sponsorId), { balance: 9_500, sum: 9_500, last: 9_500 });
});

function studentCtx(student: StudentFx, now: Date): ActionContext {
  return {
    principal: {
      userId: student.user.id, sessionId: "uji", role: "STUDENT", name: student.user.name, schoolId: student.school.id, sponsorId: null,
      studentId: student.student.id, studentStatus: "ACTIVE", sponsorStatus: null, mustChangePassword: false, totpEnrollmentRequired: false, platform: "ANDROID", deviceId: null,
    },
    now, requestId: "uji-klik", ip: null, userAgent: null, defer: () => undefined,
  };
}

test("hari WIB berikutnya klik yang sama ditagih lagi", async () => {
  const { ad, sp, school } = await setup(10_000);
  const student = await studentFx(school);
  await viewAndClick(student, ad.id);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const token = await signAdToken({ adId: ad.id, sponsorId: sp.sponsorId, userId: student.user.id, schoolId: school.id }, getEnv().AD_EVENT_SECRET, tomorrow);
  getImpressionStore().record(student.user.id, ad.id, tomorrow);
  const outcome = await recordClick(studentCtx(student, tomorrow), { token, deviceType: "MOBILE" });
  assert.equal(outcome.billing, "CHARGED");
  assert.equal(await prisma.adClick.count({ where: { adId: ad.id, billing: "CHARGED" } }), 2);
});

test("SUSPECT tidak ditagih: tanpa impresi 30 menit sebelumnya, atau siswa aktif < 7 hari", async () => {
  const { sp, ad, school } = await setup(10_000);
  const noView = await studentFx(school);
  const token = await servedTokenFor(noView, ad.id);
  assert.equal((await click(noView.token, token)).status, 200);
  const fresh = await studentFx(school, { activatedAt: new Date(Date.now() - 2 * 86_400_000) });
  await viewAndClick(fresh, ad.id);
  assert.deepEqual(await billingsOf(ad.id), ["SUSPECT", "SUSPECT"]);
  assert.equal((await prisma.sponsor.findFirstOrThrow({ where: { id: sp.sponsorId } })).balance, 10_000);
  const stat = await statOf(ad.id);
  assert.deepEqual([stat?.clicks, stat?.chargedClicks, stat?.spend], [2, 0, 0]);
});

test("iklan dijeda: klik tercatat AD_NOT_LIVE, targetUrl null, tanpa tagihan; token siswa lain / palsu 403 tanpa baris", async () => {
  const { sp, ad, school } = await setup(10_000);
  const [s1, s2] = [await studentFx(school), await studentFx(school)];
  const t1 = await servedTokenFor(s1, ad.id);
  await impress(s1.token, [t1]);
  const stolen = await click(s2.token, t1);
  assert.equal(stolen.status, 403);
  assert.equal(stolen.body?.error?.code, "AD_TOKEN_INVALID");
  assert.equal((await click(s1.token, `${t1}x`)).status, 403);
  assert.equal(await prisma.adClick.count({ where: { adId: ad.id } }), 0);
  await callRoute(pauseRoute, { method: "POST", url: `/api/v1/sponsor/ads/${ad.id}/pause`, params: { id: ad.id }, bearer: sp.token });
  const res = await click(s1.token, t1);
  assert.deepEqual(res.body?.data, { targetUrl: null, linkType: "EXTERNAL_URL" });
  assert.deepEqual(await billingsOf(ad.id), ["AD_NOT_LIVE"]);
});

test("20 klik paralel (20 siswa) dengan saldo untuk 5 klik: tepat 5 ditagih, saldo 0, seq berurutan, saldo == ledger", async () => {
  const { sp, ad, school } = await setup(2_500);
  const students = await Promise.all(Array.from({ length: 20 }, () => studentFx(school)));
  const tokens = await Promise.all(students.map((s) => servedTokenFor(s, ad.id)));
  await Promise.all(students.map((s, i) => impress(s.token, [tokens[i] ?? ""])));
  const results = await Promise.all(students.map((s, i) => click(s.token, tokens[i] ?? "")));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  const billings = await billingsOf(ad.id);
  assert.equal(billings.filter((b) => b === "CHARGED").length, 5);
  assert.equal(billings.filter((b) => b === "INSUFFICIENT_BALANCE").length, 15);
  const entries = await prisma.sponsorLedgerEntry.findMany({ where: { sponsorId: sp.sponsorId }, orderBy: { seq: "asc" }, select: { seq: true, balanceAfter: true } });
  assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.ok(entries.every((e) => e.balanceAfter >= 0));
  assert.deepEqual(await ledgerInvariant(sp.sponsorId), { balance: 0, sum: 0, last: 0 });
  const stat = await statOf(ad.id);
  assert.deepEqual([stat?.clicks, stat?.chargedClicks, stat?.spend, stat?.uniqueClicks], [20, 5, 2_500, 20]);
});

test("klik ganda paralel siswa yang sama: tepat satu ditagih", async () => {
  const { ad, school } = await setup(10_000);
  const student = await studentFx(school);
  const token = await servedTokenFor(student, ad.id);
  await impress(student.token, [token]);
  await Promise.all([click(student.token, token), click(student.token, token), click(student.token, token)]);
  const billings = await billingsOf(ad.id);
  assert.equal(billings.filter((b) => b === "CHARGED").length, 1);
  assert.equal(billings.length, 3);
});

test("notifikasi saldo menipis tepat sekali saat melewati ambang; habis saat di bawah CPC", async () => {
  const { sp, ad, school } = await setup(100_500);
  const lowCount = () => prisma.notification.count({ where: { userId: sp.user.id, type: "LOW_BALANCE" } });
  await viewAndClick(await studentFx(school), ad.id);
  assert.equal(await lowCount(), 0, "100.000 belum di bawah ambang");
  await viewAndClick(await studentFx(school), ad.id);
  assert.equal(await lowCount(), 1);
  await viewAndClick(await studentFx(school), ad.id);
  assert.equal(await lowCount(), 1, "penurunan berikutnya di bawah ambang tidak memberi notifikasi lagi");
  const low = await setup(500);
  await viewAndClick(await studentFx(low.school), low.ad.id);
  const exhausted = await prisma.notification.findFirstOrThrow({ where: { userId: low.sp.user.id, type: "LOW_BALANCE" }, select: { title: true } });
  assert.match(exhausted.title, /habis/);
});

test("batas laju: klik ke-11 dalam 60 detik 429 tanpa baris", async () => {
  const { ad, school } = await setup(10_000);
  const student = await studentFx(school);
  const token = await servedTokenFor(student, ad.id);
  for (let i = 0; i < 10; i += 1) assert.equal((await click(student.token, token)).status, 200);
  const limited = await click(student.token, token);
  assert.equal(limited.status, 429);
  assert.equal(await prisma.adClick.count({ where: { adId: ad.id } }), 10);
});
