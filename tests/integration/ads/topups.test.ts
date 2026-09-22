/**
 * Top-up saldo: pengajuan multipart (hanya APPROVED), aturan nominal/tanggal/batas menunggu, persetujuan CAS
 * (persetujuan ganda bersamaan -> tepat satu entri ledger), penolakan beralasan, pembatalan, IDOR antar sponsor,
 * penanda bukti identik, akses berkas bukti.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as fileRoute } from "@/app/api/v1/files/[id]/route";
import { POST as approveRoute } from "@/app/api/v1/platform/topups/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/platform/topups/[id]/reject/route";
import { GET as topUpDetail } from "@/app/api/v1/platform/topups/[id]/route";
import { GET as queueRoute } from "@/app/api/v1/platform/topups/route";
import { GET as balanceRoute } from "@/app/api/v1/sponsor/balance/route";
import { POST as cancelRoute } from "@/app/api/v1/sponsor/topups/[id]/cancel/route";
import { GET as ownListRoute, POST as submitRoute } from "@/app/api/v1/sponsor/topups/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { setStorageDriver } from "@/lib/storage/driver";
import { addDays } from "@/lib/time/zone";
import { disconnect, prisma } from "../helpers/db";
import { callRoute, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import { bannerBlob, callMultipart, ledgerInvariant, sponsorFx, superFx, todayWib, type SponsorFx } from "./fixtures";

let storage: TempStorage;
let superToken = "";
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  superToken = (await superFx()).token;
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

interface TopUpBody {
  id: string;
  status: string;
  amount: number;
  proofFileId: string;
  duplicateProofOf?: string[];
}

async function submit(sp: SponsorFx, fields: { amount?: string; transferDate?: string; file?: Blob } = {}) {
  resetAllLimiters();
  const form = new FormData();
  form.set("amount", fields.amount ?? "250000");
  form.set("transferDate", fields.transferDate ?? todayWib());
  form.set("senderName", "PT Pengirim");
  form.set("senderBank", "BCA");
  form.set("file", fields.file ?? (await bannerBlob(600, 800)), "bukti.png");
  return callMultipart<Envelope<TopUpBody>>(submitRoute, { url: "/api/v1/sponsor/topups", form, bearer: sp.token });
}

const approve = (id: string) => callRoute<Envelope<{ topUp: TopUpBody; ledgerEntry: { seq: number; balanceAfter: number } }>>(approveRoute, {
  method: "POST", url: `/api/v1/platform/topups/${id}/approve`, params: { id }, bearer: superToken,
});

test("sponsor APPROVED mengajukan top-up; super admin menerima notifikasi; sponsor PENDING/SUSPENDED ditolak 403", async () => {
  const sp = await sponsorFx();
  const res = await submit(sp);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body?.data.status, "PENDING");
  const file = await prisma.storedFile.findFirstOrThrow({ where: { id: res.body?.data.proofFileId }, select: { kind: true, sponsorId: true, storageKey: true } });
  assert.equal(file.kind, "TOPUP_PROOF");
  assert.equal(file.sponsorId, sp.sponsorId);
  assert.match(file.storageKey, /^private\/topup-proof\//);
  assert.ok((await prisma.notification.count({ where: { type: "TOPUP_SUBMITTED", data: { path: "$.id", equals: res.body?.data.id ?? "" } } })) >= 1);
  for (const status of ["PENDING", "SUSPENDED"] as const) {
    const other = await sponsorFx(status);
    const denied = await submit(other);
    assert.equal(denied.status, 403);
    assert.equal(denied.body?.error?.code, status === "PENDING" ? "SPONSOR_NOT_APPROVED" : "SPONSOR_SUSPENDED");
  }
});

test("aturan top-up: di bawah minimal 422, tanggal transfer masa depan / > 30 hari 422, maks 3 menunggu 409", async () => {
  const sp = await sponsorFx();
  const low = await submit(sp, { amount: "99999" });
  assert.equal(low.body?.error?.code, "TOPUP_AMOUNT_INVALID");
  assert.equal((await submit(sp, { transferDate: addDays(todayWib(), 1) })).body?.error?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  assert.equal((await submit(sp, { transferDate: addDays(todayWib(), -31) })).body?.error?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  for (let i = 0; i < 3; i += 1) assert.equal((await submit(sp)).status, 201);
  const fourth = await submit(sp);
  assert.equal(fourth.status, 409);
  assert.equal(fourth.body?.error?.code, "TOPUP_LIMIT");
  assert.equal(await prisma.storedFile.count({ where: { sponsorId: sp.sponsorId, kind: "TOPUP_PROOF" } }), 3, "berkas pengajuan yang ditolak tidak tersisa");
});

test("persetujuan ganda bersamaan: tepat satu berhasil, satu entri TOPUP, saldo == ledger, notifikasi & audit", async () => {
  const sp = await sponsorFx();
  const id = (await submit(sp, { amount: "300000" })).body?.data.id ?? "";
  const results = await Promise.all([approve(id), approve(id), approve(id)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  assert.ok(results.filter((r) => r.status === 409).every((r) => r.body?.error?.code === "TOPUP_ALREADY_REVIEWED"));
  const ok = results.find((r) => r.status === 200)?.body?.data;
  assert.deepEqual([ok?.topUp.status, ok?.ledgerEntry.seq, ok?.ledgerEntry.balanceAfter], ["APPROVED", 1, 300_000]);
  assert.equal(await prisma.sponsorLedgerEntry.count({ where: { sponsorId: sp.sponsorId, type: "TOPUP" } }), 1);
  assert.deepEqual(await ledgerInvariant(sp.sponsorId), { balance: 300_000, sum: 300_000, last: 300_000 });
  assert.equal(await prisma.notification.count({ where: { userId: sp.user.id, type: "TOPUP_APPROVED" } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { action: "topup.approve", entityId: id } }), 1);
  const card = await callRoute<Envelope<{ balance: number; totalTopUp: number; estimatedClicksRemaining: number }>>(balanceRoute, { method: "GET", url: "/api/v1/sponsor/balance", bearer: sp.token });
  assert.deepEqual([card.body?.data.balance, card.body?.data.totalTopUp, card.body?.data.estimatedClicksRemaining], [300_000, 300_000, 600]);
});

test("tolak wajib alasan; top-up tertolak/dibatalkan tidak bisa disetujui (409)", async () => {
  const sp = await sponsorFx();
  const a = (await submit(sp)).body?.data.id ?? "";
  const b = (await submit(sp)).body?.data.id ?? "";
  const noReason = await callRoute<Envelope>(rejectRoute, { method: "POST", url: `/api/v1/platform/topups/${a}/reject`, params: { id: a }, bearer: superToken, json: {} });
  assert.equal(noReason.status, 400);
  const rejected = await callRoute<Envelope<TopUpBody & { reviewNote: string }>>(rejectRoute, {
    method: "POST", url: `/api/v1/platform/topups/${a}/reject`, params: { id: a }, bearer: superToken, json: { reason: "Bukti tidak terbaca" },
  });
  assert.equal(rejected.body?.data.status, "REJECTED");
  assert.equal(rejected.body?.data.reviewNote, "Bukti tidak terbaca");
  assert.equal((await approve(a)).body?.error?.code, "TOPUP_ALREADY_REVIEWED");
  const cancelled = await callRoute<Envelope<TopUpBody>>(cancelRoute, { method: "POST", url: `/api/v1/sponsor/topups/${b}/cancel`, params: { id: b }, bearer: sp.token });
  assert.equal(cancelled.body?.data.status, "CANCELLED");
  assert.equal((await approve(b)).status, 409);
  const again = await callRoute<Envelope>(cancelRoute, { method: "POST", url: `/api/v1/sponsor/topups/${b}/cancel`, params: { id: b }, bearer: sp.token });
  assert.equal(again.body?.error?.code, "TOPUP_ALREADY_REVIEWED");
  assert.equal((await prisma.sponsor.findFirstOrThrow({ where: { id: sp.sponsorId } })).balance, 0);
  const own = await callRoute<Envelope<TopUpBody[]>>(ownListRoute, { method: "GET", url: "/api/v1/sponsor/topups?status=REJECTED", bearer: sp.token });
  assert.deepEqual(own.body?.data.map((t) => t.id), [a]);
});

test("IDOR: sponsor lain tidak bisa membatalkan atau mengunduh bukti top-up (404); super admin bisa", async () => {
  const [a, b] = [await sponsorFx(), await sponsorFx()];
  const topUp = (await submit(a)).body?.data;
  assert.ok(topUp);
  const cancel = await callRoute<Envelope>(cancelRoute, { method: "POST", url: `/api/v1/sponsor/topups/${topUp.id}/cancel`, params: { id: topUp.id }, bearer: b.token });
  assert.equal(cancel.status, 404);
  assert.equal(cancel.body?.error?.code, "TOPUP_NOT_FOUND");
  const fileUrl = `/api/v1/files/${topUp.proofFileId}`;
  const params = { id: topUp.proofFileId };
  assert.equal((await callRoute(fileRoute, { method: "GET", url: fileUrl, params, bearer: b.token })).status, 404);
  assert.equal((await callRoute(fileRoute, { method: "GET", url: fileUrl, params, bearer: a.token })).status, 200);
  assert.equal((await callRoute(fileRoute, { method: "GET", url: fileUrl, params, bearer: superToken })).status, 200);
  const list = await callRoute<Envelope<TopUpBody[]>>(ownListRoute, { method: "GET", url: "/api/v1/sponsor/topups", bearer: b.token });
  assert.equal(list.body?.data.length, 0);
});

test("antrean super admin: filter sponsor, detail, penanda bukti identik lintas sponsor", async () => {
  const [a, b] = [await sponsorFx(), await sponsorFx()];
  const proof = await bannerBlob(640, 900);
  const first = (await submit(a, { file: proof })).body?.data.id ?? "";
  const second = (await submit(b, { file: proof })).body?.data.id ?? "";
  const queue = await callRoute<Envelope<TopUpBody[]>>(queueRoute, { method: "GET", url: `/api/v1/platform/topups?sponsorId=${b.sponsorId}`, bearer: superToken });
  assert.deepEqual(queue.body?.data.map((t) => t.id), [second]);
  assert.deepEqual(queue.body?.data[0]?.duplicateProofOf, [first]);
  const detail = await callRoute<Envelope<TopUpBody>>(topUpDetail, { method: "GET", url: `/api/v1/platform/topups/${first}`, params: { id: first }, bearer: superToken });
  assert.deepEqual(detail.body?.data.duplicateProofOf, [second]);
  const missing = await callRoute<Envelope>(topUpDetail, { method: "GET", url: "/api/v1/platform/topups/x", params: { id: "x" }, bearer: superToken });
  assert.equal(missing.status, 404);
  assert.equal((await callRoute(queueRoute, { method: "GET", url: "/api/v1/platform/topups", bearer: a.token })).status, 403);
});
