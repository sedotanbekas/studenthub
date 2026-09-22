/**
 * Siklus iklan: banner (validasi & privasi sebelum disetujui), draf + validasi tautan, submit (CPC di-snapshot),
 * review (CAS submittedAt, persetujuan bersamaan), edit iklan aktif -> review ulang, jeda/lanjut/arsip, hapus draf,
 * IDOR dua sponsor.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { GET as fileRoute } from "@/app/api/v1/files/[id]/route";
import { POST as rejectRoute } from "@/app/api/v1/platform/ads/[id]/reject/route";
import { GET as platformAdRoute } from "@/app/api/v1/platform/ads/[id]/route";
import { POST as takedownRoute } from "@/app/api/v1/platform/ads/[id]/takedown/route";
import { GET as platformAdsRoute } from "@/app/api/v1/platform/ads/route";
import { PATCH as settingsPatch } from "@/app/api/v1/platform/settings/ads/route";
import { POST as archiveRoute } from "@/app/api/v1/sponsor/ads/[id]/archive/route";
import { POST as pauseRoute } from "@/app/api/v1/sponsor/ads/[id]/pause/route";
import { POST as resumeRoute } from "@/app/api/v1/sponsor/ads/[id]/resume/route";
import { DELETE as deleteRoute, GET as getAdRoute, PATCH as patchRoute } from "@/app/api/v1/sponsor/ads/[id]/route";
import { POST as withdrawRoute } from "@/app/api/v1/sponsor/ads/[id]/withdraw/route";
import { GET as listAdsRoute, POST as createAdRoute } from "@/app/api/v1/sponsor/ads/route";
import { GET as schoolsRoute } from "@/app/api/v1/sponsor/targeting/schools/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { setStorageDriver } from "@/lib/storage/driver";
import { publicKeyFor } from "@/lib/storage/keys";
import { disconnect, prisma } from "../helpers/db";
import { createSchool } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope } from "../helpers/request";
import { createTempStorage, type TempStorage } from "../helpers/storage";
import {
  adInput, approveAd, bannerBlob, bannerId, createDraft, fund, isolateServing, liveAd, schoolTarget, serve, sponsorFx, studentFx, submitAd,
  superFx, uploadBanner, type AdBody,
} from "./fixtures";

let storage: TempStorage;
let superToken = "";
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  superToken = (await superFx()).token;
  await isolateServing();
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const adUrl = (id: string, verb = "") => `/api/v1/sponsor/ads/${id}${verb ? `/${verb}` : ""}`;
const post = (handler: AnyRouteHandler, token: string, id: string, verb: string, json?: unknown) =>
  callRoute<Envelope<AdBody>>(handler, { method: "POST", url: adUrl(id, verb), params: { id }, bearer: token, ...(json ? { json } : {}) });
const patch = (token: string, id: string, json: unknown) =>
  callRoute<Envelope<{ ad: AdBody; reReviewTriggered: boolean }>>(patchRoute, { method: "PATCH", url: adUrl(id), params: { id }, bearer: token, json });
const publicFile = async (fileId: string): Promise<boolean> => {
  const file = await prisma.storedFile.findFirstOrThrow({ where: { id: fileId }, select: { storageKey: true } });
  return existsSync(join(storage.root, ...publicKeyFor(file.storageKey).split("/")));
};

test("banner: rasio salah / terlalu kecil 422 BANNER_INVALID; valid -> WebP 1200x600 privat", async () => {
  const sp = await sponsorFx("PENDING");
  resetAllLimiters();
  const ratio = await uploadBanner(sp.token, await bannerBlob(1200, 700));
  assert.equal(ratio.status, 422);
  assert.equal(ratio.body?.error?.code, "BANNER_INVALID");
  assert.equal((await uploadBanner(sp.token, await bannerBlob(700, 350))).body?.error?.code, "BANNER_INVALID");
  const ok = await uploadBanner(sp.token, await bannerBlob(1600, 812));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual([ok.body?.data.width, ok.body?.data.height], [1200, 600]);
  const row = await prisma.storedFile.findFirstOrThrow({ where: { id: ok.body?.data.fileId }, select: { kind: true, mimeType: true, attachedAt: true, storageKey: true } });
  assert.deepEqual([row.kind, row.mimeType, row.attachedAt], ["AD_BANNER", "image/webp", null]);
  assert.match(row.storageKey, /^private\/ad-banner\//);
  const suspended = await sponsorFx("SUSPENDED");
  assert.equal((await uploadBanner(suspended.token)).status, 403);
});

test("privasi banner: sebelum disetujui hanya pemilik & super admin; publik setelah approve; dihapus setelah takedown", async () => {
  const [a, b] = [await sponsorFx(), await sponsorFx()];
  const school = await createSchool();
  const student = await studentFx(school);
  const draft = await createDraft(a.token, await bannerId(a.token), schoolTarget(school.id));
  const view = (token: string) => callRoute(fileRoute, { method: "GET", url: `/api/v1/files/${draft.imageFileId}`, params: { id: draft.imageFileId }, bearer: token });
  assert.equal((await view(a.token)).status, 200);
  assert.equal((await view(superToken)).status, 200);
  assert.equal((await view(b.token)).status, 404);
  assert.equal((await view(student.token)).status, 404);
  assert.equal(draft.imageUrl, null);
  assert.equal(await publicFile(draft.imageFileId), false);
  const submitted = await submitAd(a.token, draft.id);
  assert.equal(await publicFile(draft.imageFileId), false, "masih privat saat menunggu review");
  const approved = await approveAd(superToken, draft.id, submitted.body?.data.submittedAt ?? "");
  assert.equal(approved.status, 200);
  assert.equal(await publicFile(draft.imageFileId), true);
  assert.match(approved.body?.data.imageUrl ?? "", /\/ad-banner\/.+\.webp$/);
  const down = await post(takedownRoute, superToken, draft.id, "takedown", { reason: "Melanggar pedoman konten" });
  assert.equal(down.body?.data.status, "REJECTED");
  assert.equal(await publicFile(draft.imageFileId), false);
  assert.equal(down.body?.data.imageUrl, null);
});

test("tautan: http/javascript/data/intent & skema di luar allowlist ditolak 422; deep link allowlist diterima", async () => {
  const sp = await sponsorFx();
  const fileId = await bannerId(sp.token);
  await callRoute(settingsPatch, { method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken, json: { deepLinkSchemes: ["shopee", "tokopedia", "whatsapp"] } });
  for (const [linkType, targetUrl] of [
    ["EXTERNAL_URL", "http://promo.example.com"], ["EXTERNAL_URL", "javascript:alert(1)"], ["EXTERNAL_URL", "data:text/html,x"],
    ["DEEP_LINK", "intent://scan#Intent;end"], ["DEEP_LINK", "lazada://product/1"], ["EXTERNAL_URL", "https://127.0.0.1/x"],
  ] as const) {
    const res = await callRoute<Envelope>(createAdRoute, { method: "POST", url: "/api/v1/sponsor/ads", bearer: sp.token, json: adInput(fileId, { linkType, targetUrl }) });
    assert.equal(res.status, 422, targetUrl);
    assert.equal(res.body?.error?.code, "AD_LINK_INVALID");
  }
  const deep = await createDraft(sp.token, fileId, { linkType: "DEEP_LINK", targetUrl: "shopee://product/123" });
  assert.equal(deep.targetUrl, "shopee://product/123");
  const idn = await createDraft(sp.token, fileId, { targetUrl: "https://tokopédia.com/promo" });
  const review = await callRoute<Envelope<{ isPunycodeHost: boolean; urlHost: string }>>(platformAdRoute, { method: "GET", url: `/api/v1/platform/ads/${idn.id}`, params: { id: idn.id }, bearer: superToken });
  assert.equal(review.body?.data.isPunycodeHost, true);
});

test("jadwal & target tidak valid 422; sponsor PENDING boleh draf tetapi submit 403", async () => {
  const sp = await sponsorFx("PENDING");
  const fileId = await bannerId(sp.token);
  const now = Date.now();
  const shortRun = await callRoute<Envelope>(createAdRoute, { method: "POST", url: "/api/v1/sponsor/ads", bearer: sp.token, json: adInput(fileId, { startAt: new Date(now).toISOString(), endAt: new Date(now + 60_000).toISOString() }) });
  assert.equal(shortRun.body?.error?.code, "AD_SCHEDULE_INVALID");
  const badTarget = await callRoute<Envelope>(createAdRoute, { method: "POST", url: "/api/v1/sponsor/ads", bearer: sp.token, json: adInput(fileId, { targetScope: "PROVINCE", targets: { provinceCodes: ["99"] } }) });
  assert.equal(badTarget.body?.error?.code, "AD_TARGETS_INVALID");
  const draft = await createDraft(sp.token, fileId, { targetScope: "CITY", targets: { cityCodes: ["32.73", "31.71"] } });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.targets.length, 2);
  const submitted = await submitAd(sp.token, draft.id);
  assert.equal(submitted.status, 403);
  assert.equal(submitted.body?.error?.code, "SPONSOR_NOT_APPROVED");
});

test("submit men-snapshot CPC saat submit; approve dengan submittedAt basi 409; approve bersamaan -> satu berhasil", async () => {
  const sp = await sponsorFx();
  const draft = await createDraft(sp.token, await bannerId(sp.token));
  await callRoute(settingsPatch, { method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken, json: { defaultCpcAmount: 700 } });
  try {
    const submitted = await submitAd(sp.token, draft.id);
    assert.equal(submitted.body?.data.cpcAmount, 700);
    assert.equal(submitted.body?.data.status, "PENDING_REVIEW");
    assert.ok((await prisma.notification.count({ where: { type: "AD_SUBMITTED", data: { path: "$.id", equals: draft.id } } })) >= 1);
    const stale = await approveAd(superToken, draft.id, new Date(Date.parse(submitted.body?.data.submittedAt ?? "") - 1000).toISOString());
    assert.equal(stale.body?.error?.code, "AD_REVIEW_STALE");
    const token = submitted.body?.data.submittedAt ?? "";
    const results = await Promise.all([approveAd(superToken, draft.id, token), approveAd(superToken, draft.id, token)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await prisma.auditLog.count({ where: { action: "ad.approve", entityId: draft.id } }), 1);
  } finally {
    await callRoute(settingsPatch, { method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken, json: { defaultCpcAmount: 500 } });
  }
});

test("tolak (alasan + versi), ajukan ulang dari REJECTED, tarik pengajuan, edit saat menunggu 409", async () => {
  const sp = await sponsorFx();
  const draft = await createDraft(sp.token, await bannerId(sp.token));
  const first = (await submitAd(sp.token, draft.id)).body?.data.submittedAt ?? "";
  const pendingEdit = await patch(sp.token, draft.id, { title: "Judul Baru" });
  assert.equal(pendingEdit.body?.error?.code, "AD_EDIT_WHILE_PENDING");
  const rejected = await callRoute<Envelope<AdBody & { reviewNote: string }>>(rejectRoute, {
    method: "POST", url: `/api/v1/platform/ads/${draft.id}/reject`, params: { id: draft.id }, bearer: superToken, json: { submittedAt: first, reason: "Gambar kurang jelas" },
  });
  assert.equal(rejected.body?.data.status, "REJECTED");
  assert.equal(rejected.body?.data.reviewNote, "Gambar kurang jelas");
  assert.equal((await submitAd(sp.token, draft.id)).body?.data.status, "PENDING_REVIEW");
  const withdrawn = await post(withdrawRoute, sp.token, draft.id, "withdraw");
  assert.deepEqual([withdrawn.body?.data.status, withdrawn.body?.data.submittedAt], ["DRAFT", null]);
  assert.equal((await post(withdrawRoute, sp.token, draft.id, "withdraw")).body?.error?.code, "AD_INVALID_TRANSITION");
});

test("edit iklan aktif: judul/jadwal tetap APPROVED; gambar/target -> PENDING_REVIEW & hilang dari slider", async () => {
  const sp = await sponsorFx();
  await fund(sp.sponsorId, 100_000);
  const school = await createSchool();
  const student = await studentFx(school);
  const ad = await liveAd(sp, superToken, schoolTarget(school.id));
  assert.ok((await serve(student.token)).body?.data.ads.some((a) => a.adId === ad.id));
  const titleOnly = await patch(sp.token, ad.id, { title: "Promo Akhir Pekan", expectedUpdatedAt: ad.updatedAt });
  assert.equal(titleOnly.status, 200, JSON.stringify(titleOnly.body));
  assert.deepEqual([titleOnly.body?.data.ad.status, titleOnly.body?.data.reReviewTriggered], ["APPROVED", false]);
  const stale = await patch(sp.token, ad.id, { title: "Lagi", expectedUpdatedAt: ad.updatedAt });
  assert.equal(stale.body?.error?.code, "STATE_CONFLICT");
  const newImage = await patch(sp.token, ad.id, { imageFileId: await bannerId(sp.token) });
  assert.deepEqual([newImage.body?.data.ad.status, newImage.body?.data.reReviewTriggered], ["PENDING_REVIEW", true]);
  assert.equal(await publicFile(ad.imageFileId), false, "salinan publik banner lama dihapus");
  assert.equal((await serve(student.token)).body?.data.ads.some((a) => a.adId === ad.id), false);
  const oldFile = await prisma.storedFile.findFirstOrThrow({ where: { id: ad.imageFileId }, select: { attachedAt: true } });
  assert.equal(oldFile.attachedAt, null, "banner lama kembali yatim");
});

test("jeda/lanjut/arsip; lanjut butuh sponsor APPROVED; arsip terminal; hapus hanya draf", async () => {
  const sp = await sponsorFx();
  const ad = await liveAd(sp, superToken);
  assert.equal((await post(pauseRoute, sp.token, ad.id, "pause")).body?.data.status, "PAUSED");
  assert.equal((await post(resumeRoute, sp.token, ad.id, "resume")).body?.data.status, "APPROVED");
  assert.equal((await post(archiveRoute, sp.token, ad.id, "archive")).body?.data.status, "ARCHIVED");
  assert.equal((await post(resumeRoute, sp.token, ad.id, "resume")).body?.error?.code, "AD_INVALID_TRANSITION");
  assert.equal((await patch(sp.token, ad.id, { title: "Arsip" })).body?.error?.code, "AD_INVALID_TRANSITION");
  const del = await callRoute<Envelope>(deleteRoute, { method: "DELETE", url: adUrl(ad.id), params: { id: ad.id }, bearer: sp.token });
  assert.equal(del.body?.error?.code, "AD_NOT_DELETABLE");
  const draft = await createDraft(sp.token, await bannerId(sp.token));
  const ok = await callRoute<Envelope<{ id: string }>>(deleteRoute, { method: "DELETE", url: adUrl(draft.id), params: { id: draft.id }, bearer: sp.token });
  assert.equal(ok.body?.data.id, draft.id);
  assert.equal(await prisma.ad.count({ where: { id: draft.id } }), 0);
  assert.equal((await prisma.storedFile.findFirstOrThrow({ where: { id: draft.imageFileId } })).attachedAt, null);
});

test("IDOR dua sponsor: baca/ubah/submit/jeda/hapus iklan & pakai banner sponsor lain -> 404", async () => {
  const [a, b] = [await sponsorFx(), await sponsorFx()];
  const bAd = await createDraft(b.token, await bannerId(b.token));
  const bBanner = await bannerId(b.token);
  assert.equal((await callRoute<Envelope>(getAdRoute, { method: "GET", url: adUrl(bAd.id), params: { id: bAd.id }, bearer: a.token })).body?.error?.code, "AD_NOT_FOUND");
  assert.equal((await patch(a.token, bAd.id, { title: "Dibajak" })).status, 404);
  assert.equal((await submitAd(a.token, bAd.id)).status, 404);
  assert.equal((await post(pauseRoute, a.token, bAd.id, "pause")).status, 404);
  assert.equal((await callRoute(deleteRoute, { method: "DELETE", url: adUrl(bAd.id), params: { id: bAd.id }, bearer: a.token })).status, 404);
  const steal = await callRoute<Envelope>(createAdRoute, { method: "POST", url: "/api/v1/sponsor/ads", bearer: a.token, json: adInput(bBanner) });
  assert.equal(steal.body?.error?.code, "BANNER_NOT_FOUND");
  const aList = await callRoute<Envelope<AdBody[]>>(listAdsRoute, { method: "GET", url: "/api/v1/sponsor/ads", bearer: a.token });
  assert.equal(aList.body?.data.length, 0);
  assert.equal((await prisma.ad.findFirstOrThrow({ where: { id: bAd.id } })).title, "Promo Uji");
});

test("antrean review super admin & pemilih sekolah target; sponsor tidak bisa akses endpoint review", async () => {
  const sp = await sponsorFx();
  const draft = await createDraft(sp.token, await bannerId(sp.token));
  await submitAd(sp.token, draft.id);
  const queue = await callRoute<Envelope<Array<{ id: string; sponsor: { id: string } }>>>(platformAdsRoute, { method: "GET", url: `/api/v1/platform/ads?sponsorId=${sp.sponsorId}`, bearer: superToken });
  assert.deepEqual(queue.body?.data.map((a) => a.id), [draft.id]);
  assert.equal((await callRoute(platformAdsRoute, { method: "GET", url: "/api/v1/platform/ads", bearer: sp.token })).status, 403);
  const school = await createSchool({ data: { name: "SMA Target Uji Nusantara" } });
  const found = await callRoute<Envelope<Array<{ id: string; provinceName: string }>>>(schoolsRoute, { method: "GET", url: "/api/v1/sponsor/targeting/schools?q=Target%20Uji%20Nusantara&provinceCode=32", bearer: sp.token });
  assert.ok(found.body?.data.some((s) => s.id === school.id));
});
