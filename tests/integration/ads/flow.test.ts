/**
 * Alur P4 ujung-ke-ujung lewat route asli (setara E2E PLAN): super admin membuat & menyetujui sponsor -> sponsor
 * login, ganti kata sandi, unggah banner, buat & ajukan iklan -> super admin menyetujui -> sponsor top-up dengan
 * bukti -> super admin menyetujui -> siswa melihat slider, impresi, klik -> analitik & saldo sponsor sesuai,
 * saldo == ledger.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as changePasswordRoute } from "@/app/api/v1/auth/change-password/route";
import { POST as loginRoute } from "@/app/api/v1/auth/login/route";
import { POST as approveTopUpRoute } from "@/app/api/v1/platform/topups/[id]/approve/route";
import { POST as approveSponsorRoute } from "@/app/api/v1/platform/sponsors/[id]/approve/route";
import { POST as createSponsorRoute } from "@/app/api/v1/platform/sponsors/route";
import { GET as summaryRoute } from "@/app/api/v1/sponsor/analytics/summary/route";
import { GET as balanceRoute } from "@/app/api/v1/sponsor/balance/route";
import { POST as topUpRoute } from "@/app/api/v1/sponsor/topups/route";
import { setStorageDriver } from "@/lib/storage/driver";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  approveAd, bannerBlob, bannerId, callMultipart, click, createDraft, impress, isolateServing, ledgerInvariant, resetEventState, schoolTarget, serve,
  studentFx, submitAd, superFx, todayWib,
} from "./fixtures";

let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  await isolateServing();
  resetEventState();
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

async function login(email: string, password: string): Promise<string> {
  const res = await callRoute<Envelope<{ accessToken: string }>>(loginRoute, { method: "POST", url: "/api/v1/auth/login", json: { identifier: email, password, platform: "WEB" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body?.data.accessToken ?? "";
}

test("alur sponsor -> iklan -> top-up -> tayang -> klik -> analitik & saldo", async () => {
  const admin = await superFx();
  const email = uniqEmail("flow");
  const created = await callRoute<Envelope<{ sponsor: { id: string }; temporaryPassword: string }>>(createSponsorRoute, {
    method: "POST", url: "/api/v1/platform/sponsors", bearer: admin.token,
    json: { companyName: "PT Alur Uji", contactName: "Kontak Alur", contactEmail: email, contactPhone: "+6281200000000", login: { name: "Login Alur", email } },
  });
  const sponsorId = created.body?.data.sponsor.id ?? "";
  let token = await login(email, created.body?.data.temporaryPassword ?? "");
  const blocked = await callRoute<Envelope>(balanceRoute, { method: "GET", url: "/api/v1/sponsor/balance", bearer: token });
  assert.equal(blocked.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await callRoute(changePasswordRoute, { method: "POST", url: "/api/v1/auth/change-password", bearer: token, json: { currentPassword: created.body?.data.temporaryPassword, newPassword: "SponsorBaru2026" } });
  assert.equal(changed.status, 200);
  token = await login(email, "SponsorBaru2026");

  const school = await createSchool();
  const draft = await createDraft(token, await bannerId(token), schoolTarget(school.id));
  assert.equal((await submitAd(token, draft.id)).body?.error?.code, "SPONSOR_NOT_APPROVED");
  await callRoute(approveSponsorRoute, { method: "POST", url: `/api/v1/platform/sponsors/${sponsorId}/approve`, params: { id: sponsorId }, bearer: admin.token });
  const submitted = await submitAd(token, draft.id);
  const approved = await approveAd(admin.token, draft.id, submitted.body?.data.submittedAt ?? "");
  assert.equal(approved.body?.data.displayStatus, "NO_BALANCE", "disetujui tetapi belum bersaldo");

  const form = new FormData();
  for (const [k, v] of Object.entries({ amount: "200000", transferDate: todayWib(), senderName: "PT Alur Uji", senderBank: "Mandiri" })) form.set(k, v);
  form.set("file", await bannerBlob(600, 900), "bukti.png");
  const topUp = await callMultipart<Envelope<{ id: string }>>(topUpRoute, { url: "/api/v1/sponsor/topups", form, bearer: token });
  assert.equal(topUp.status, 201, JSON.stringify(topUp.body));
  const topUpId = topUp.body?.data.id ?? "";
  assert.equal((await callRoute(approveTopUpRoute, { method: "POST", url: `/api/v1/platform/topups/${topUpId}/approve`, params: { id: topUpId }, bearer: admin.token })).status, 200);

  const student = await studentFx(school);
  const slider = await serve(student.token);
  const served = slider.body?.data.ads.find((a) => a.adId === draft.id);
  assert.ok(served, "iklan tayang ke siswa sekolah target");
  assert.deepEqual((await impress(student.token, [served.token])).body?.data, { accepted: 1, duplicate: 0, rejected: 0 });
  const clicked = await click(student.token, served.token);
  assert.equal(clicked.body?.data.targetUrl, "https://promo.example.co.id/diskon");

  const summary = await callRoute<Envelope<{ kpis: Record<string, { value: number | null }> }>>(summaryRoute, { method: "GET", url: "/api/v1/sponsor/analytics/summary?preset=7d", bearer: token });
  const k = summary.body?.data.kpis ?? {};
  assert.deepEqual([k.impressions?.value, k.clicks?.value, k.uniqueClicks?.value, k.ctr?.value, k.spend?.value], [1, 1, 1, 100, 500]);
  const card = await callRoute<Envelope<{ balance: number; totalTopUp: number; totalSpent: number }>>(balanceRoute, { method: "GET", url: "/api/v1/sponsor/balance", bearer: token });
  assert.deepEqual([card.body?.data.balance, card.body?.data.totalTopUp, card.body?.data.totalSpent], [199_500, 200_000, 500]);
  assert.deepEqual(await ledgerInvariant(sponsorId), { balance: 199_500, sum: 199_500, last: 199_500 });
  assert.equal(await prisma.sponsorLedgerEntry.count({ where: { sponsorId } }), 2);
});
