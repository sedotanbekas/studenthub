/**
 * Akun sponsor oleh super admin (buat, ubah, setujui/tangguhkan/aktifkan kembali), profil & kartu saldo sponsor,
 * penyesuaian ledger, pengaturan platform iklan, dan matriks peran (403).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as adSettingsGet, PATCH as adSettingsPatch } from "@/app/api/v1/platform/settings/ads/route";
import { POST as adjustRoute } from "@/app/api/v1/platform/sponsors/[id]/ledger-adjustments/route";
import { GET as platformLedgerRoute } from "@/app/api/v1/platform/sponsors/[id]/ledger/route";
import { POST as reactivateRoute } from "@/app/api/v1/platform/sponsors/[id]/reactivate/route";
import { GET as sponsorDetail, PATCH as sponsorPatch } from "@/app/api/v1/platform/sponsors/[id]/route";
import { POST as approveRoute } from "@/app/api/v1/platform/sponsors/[id]/approve/route";
import { POST as suspendRoute } from "@/app/api/v1/platform/sponsors/[id]/suspend/route";
import { GET as listSponsorsRoute, POST as createSponsorRoute } from "@/app/api/v1/platform/sponsors/route";
import { GET as balanceRoute } from "@/app/api/v1/sponsor/balance/route";
import { GET as ownLedgerRoute } from "@/app/api/v1/sponsor/ledger/route";
import { GET as profileGet, PATCH as profilePatch } from "@/app/api/v1/sponsor/profile/route";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { fund, ledgerInvariant, sponsorFx, studentFx, superFx, webToken } from "./fixtures";

let superToken = "";
before(async () => {
  superToken = (await superFx()).token;
});
after(disconnect);

interface SponsorBody {
  id: string;
  status: string;
  statusReason: string | null;
  balance: number;
  contactName: string;
  companyName: string;
}

const createBody = (overrides: Record<string, unknown> = {}) => ({
  companyName: `PT ${uniq("sp")}`,
  contactName: "Budi Kontak",
  contactEmail: uniqEmail("kontak"),
  contactPhone: "+6281234567890",
  login: { name: "Budi Login", email: uniqEmail("login") },
  ...overrides,
});

test("buat sponsor: PENDING saldo 0, akun SPONSOR wajib ganti sandi, sandi sementara sekali, email ganda 409", async () => {
  const body = createBody();
  const res = await callRoute<Envelope<{ sponsor: SponsorBody; userId: string; temporaryPassword?: string }>>(createSponsorRoute, {
    method: "POST", url: "/api/v1/platform/sponsors", bearer: superToken, json: body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const data = res.body?.data;
  assert.equal(data?.sponsor.status, "PENDING");
  assert.equal(data?.sponsor.balance, 0);
  assert.ok(data?.temporaryPassword && data.temporaryPassword.length >= 8);
  const user = await prisma.user.findFirstOrThrow({ where: { id: data?.userId }, select: { role: true, sponsorId: true, mustChangePassword: true } });
  assert.deepEqual(user, { role: "SPONSOR", sponsorId: data?.sponsor.id, mustChangePassword: true });
  const dup = await callRoute<Envelope>(createSponsorRoute, {
    method: "POST", url: "/api/v1/platform/sponsors", bearer: superToken, json: createBody({ login: { name: "Lain", email: body.login.email } }),
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body?.error?.code, "EMAIL_TAKEN");
  const audit = await prisma.auditLog.count({ where: { action: "sponsor.create", entityId: data?.sponsor.id } });
  assert.equal(audit, 1);
});

test("transisi status: approve -> suspend (alasan) -> reactivate; transisi tak sah 409; anggota diberi notifikasi", async () => {
  const sp = await sponsorFx("PENDING");
  const url = (verb: string) => `/api/v1/platform/sponsors/${sp.sponsorId}/${verb}`;
  const params = { id: sp.sponsorId };
  const bad = await callRoute<Envelope>(reactivateRoute, { method: "POST", url: url("reactivate"), params, bearer: superToken });
  assert.equal(bad.status, 409);
  assert.equal(bad.body?.error?.code, "SPONSOR_INVALID_TRANSITION");
  const approved = await callRoute<Envelope<SponsorBody>>(approveRoute, { method: "POST", url: url("approve"), params, bearer: superToken });
  assert.equal(approved.body?.data.status, "APPROVED");
  const noReason = await callRoute<Envelope>(suspendRoute, { method: "POST", url: url("suspend"), params, bearer: superToken, json: {} });
  assert.equal(noReason.status, 400);
  const suspended = await callRoute<Envelope<SponsorBody>>(suspendRoute, { method: "POST", url: url("suspend"), params, bearer: superToken, json: { reason: "Konten melanggar aturan" } });
  assert.equal(suspended.body?.data.status, "SUSPENDED");
  assert.equal(suspended.body?.data.statusReason, "Konten melanggar aturan");
  const back = await callRoute<Envelope<SponsorBody>>(reactivateRoute, { method: "POST", url: url("reactivate"), params, bearer: superToken });
  assert.equal(back.body?.data.status, "APPROVED");
  assert.equal(back.body?.data.statusReason, null);
  const types = await prisma.notification.findMany({ where: { userId: sp.user.id }, select: { type: true }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(types.map((t) => t.type).sort(), ["SPONSOR_APPROVED", "SPONSOR_APPROVED", "SPONSOR_SUSPENDED"]);
});

test("sponsor ditangguhkan hanya-baca: profil & saldo terbaca, ubah profil 403 SPONSOR_SUSPENDED", async () => {
  const sp = await sponsorFx("SUSPENDED");
  const profile = await callRoute<Envelope<SponsorBody>>(profileGet, { method: "GET", url: "/api/v1/sponsor/profile", bearer: sp.token });
  assert.equal(profile.status, 200);
  assert.equal(profile.body?.data.id, sp.sponsorId);
  assert.equal((await callRoute(balanceRoute, { method: "GET", url: "/api/v1/sponsor/balance", bearer: sp.token })).status, 200);
  const patch = await callRoute<Envelope>(profilePatch, { method: "PATCH", url: "/api/v1/sponsor/profile", bearer: sp.token, json: { contactName: "Nama Baru" } });
  assert.equal(patch.status, 403);
  assert.equal(patch.body?.error?.code, "SPONSOR_SUSPENDED");
});

test("sponsor PENDING boleh ubah kontak; nama perusahaan tidak bisa diubah sponsor (strict body)", async () => {
  const sp = await sponsorFx("PENDING");
  const ok = await callRoute<Envelope<SponsorBody>>(profilePatch, { method: "PATCH", url: "/api/v1/sponsor/profile", bearer: sp.token, json: { contactName: "Siti Kontak", address: "Jl. Baru 1" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body?.data.contactName, "Siti Kontak");
  const mass = await callRoute<Envelope>(profilePatch, { method: "PATCH", url: "/api/v1/sponsor/profile", bearer: sp.token, json: { companyName: "PT Palsu", balance: 1_000_000 } });
  assert.equal(mass.status, 400);
  assert.equal((await prisma.sponsor.findFirstOrThrow({ where: { id: sp.sponsorId } })).balance, 0);
});

test("super admin: daftar, detail (anggota + ringkasan saldo), ubah data perusahaan; id tak dikenal 404", async () => {
  const sp = await sponsorFx();
  await fund(sp.sponsorId, 250_000);
  const list = await callRoute<Envelope<Array<{ id: string }>>>(listSponsorsRoute, { method: "GET", url: `/api/v1/platform/sponsors?status=APPROVED&q=${encodeURIComponent("PT ")}`, bearer: superToken });
  assert.equal(list.status, 200);
  const detail = await callRoute<Envelope<{ members: unknown[]; balanceSummary: { balance: number; netAdjustment: number } }>>(sponsorDetail, {
    method: "GET", url: `/api/v1/platform/sponsors/${sp.sponsorId}`, params: { id: sp.sponsorId }, bearer: superToken,
  });
  assert.equal(detail.body?.data.members.length, 1);
  assert.deepEqual([detail.body?.data.balanceSummary.balance, detail.body?.data.balanceSummary.netAdjustment], [250_000, 250_000]);
  const patched = await callRoute<Envelope<SponsorBody>>(sponsorPatch, {
    method: "PATCH", url: `/api/v1/platform/sponsors/${sp.sponsorId}`, params: { id: sp.sponsorId }, bearer: superToken, json: { companyName: "PT Baru Jaya" },
  });
  assert.equal(patched.body?.data.companyName, "PT Baru Jaya");
  const missing = await callRoute<Envelope>(sponsorDetail, { method: "GET", url: "/api/v1/platform/sponsors/tidak-ada", params: { id: "tidak-ada" }, bearer: superToken });
  assert.equal(missing.status, 404);
  assert.equal(missing.body?.error?.code, "SPONSOR_NOT_FOUND");
});

test("penyesuaian ledger: kredit/debit tercatat & diaudit; saldo negatif 422 tanpa entri; saldo == ledger", async () => {
  const sp = await sponsorFx();
  const url = `/api/v1/platform/sponsors/${sp.sponsorId}/ledger-adjustments`;
  const params = { id: sp.sponsorId };
  const credit = await callRoute<Envelope<{ seq: number; balanceAfter: number }>>(adjustRoute, { method: "POST", url, params, bearer: superToken, json: { amount: 50_000, note: "Kompensasi klik tidak sah" } });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  assert.deepEqual([credit.body?.data.seq, credit.body?.data.balanceAfter], [1, 50_000]);
  const over = await callRoute<Envelope>(adjustRoute, { method: "POST", url, params, bearer: superToken, json: { amount: -50_001, note: "Koreksi berlebih" } });
  assert.equal(over.status, 422);
  assert.equal(over.body?.error?.code, "INSUFFICIENT_BALANCE");
  const zero = await callRoute<Envelope>(adjustRoute, { method: "POST", url, params, bearer: superToken, json: { amount: 0, note: "Koreksi nol" } });
  assert.equal(zero.status, 400);
  const debit = await callRoute<Envelope<{ seq: number; balanceAfter: number }>>(adjustRoute, { method: "POST", url, params, bearer: superToken, json: { amount: -20_000, note: "Koreksi top-up ganda" } });
  assert.deepEqual([debit.body?.data.seq, debit.body?.data.balanceAfter], [2, 30_000]);
  const inv = await ledgerInvariant(sp.sponsorId);
  assert.deepEqual(inv, { balance: 30_000, sum: 30_000, last: 30_000 });
  assert.equal(await prisma.auditLog.count({ where: { action: "sponsor.ledger.adjust", entityId: sp.sponsorId } }), 2);
  const own = await callRoute<Envelope<Array<{ seq: number; type: string }>>>(ownLedgerRoute, { method: "GET", url: "/api/v1/sponsor/ledger?type=ADJUSTMENT", bearer: sp.token });
  assert.deepEqual(own.body?.data.map((e) => e.seq), [2, 1]);
  const platform = await callRoute<Envelope<unknown[]>>(platformLedgerRoute, { method: "GET", url: `/api/v1/platform/sponsors/${sp.sponsorId}/ledger`, params, bearer: superToken });
  assert.equal(platform.body?.data.length, 2);
  const unknown = await callRoute<Envelope>(platformLedgerRoute, { method: "GET", url: "/api/v1/platform/sponsors/x/ledger", params: { id: "x" }, bearer: superToken });
  assert.equal(unknown.status, 404);
});

test("CHECK saldo >= 0 menolak UPDATE mentah ke saldo negatif", async () => {
  const sp = await sponsorFx();
  await assert.rejects(prisma.$executeRaw`UPDATE \`Sponsor\` SET \`balance\` = -1 WHERE \`id\` = ${sp.sponsorId}`);
});

test("pengaturan iklan: baca, ubah (diaudit), skema deep link berbahaya 422, kartu saldo memakai rekening", async () => {
  const current = await callRoute<Envelope<{ defaultCpcAmount: number; deepLinkSchemes: string[] }>>(adSettingsGet, { method: "GET", url: "/api/v1/platform/settings/ads", bearer: superToken });
  assert.equal(current.status, 200);
  const bad = await callRoute<Envelope>(adSettingsPatch, { method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken, json: { deepLinkSchemes: ["shopee", "javascript"] } });
  assert.equal(bad.status, 422);
  assert.equal(bad.body?.error?.code, "SETTINGS_INVALID");
  const cheap = await callRoute<Envelope>(adSettingsPatch, { method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken, json: { defaultCpcAmount: 50 } });
  assert.equal(cheap.status, 400);
  const res = await callRoute<Envelope<{ topUpBankName: string | null; deepLinkSchemes: string[] }>>(adSettingsPatch, {
    method: "PATCH", url: "/api/v1/platform/settings/ads", bearer: superToken,
    json: { topUpBankName: "Bank Uji", topUpAccountNumber: "1234567890", topUpAccountHolder: "PT Student Hub", deepLinkSchemes: ["Shopee", "tokopedia", "whatsapp", "shopee"] },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body?.data.deepLinkSchemes, ["shopee", "tokopedia", "whatsapp"]);
  const sp = await sponsorFx();
  const balance = await callRoute<Envelope<{ topUpAccount: { bankName: string } | null; minTopUpAmount: number }>>(balanceRoute, { method: "GET", url: "/api/v1/sponsor/balance", bearer: sp.token });
  assert.equal(balance.body?.data.topUpAccount?.bankName, "Bank Uji");
  assert.ok((await prisma.auditLog.count({ where: { action: "platform.ads_settings.update" } })) >= 1);
});

test("matriks peran: sponsor/admin sekolah/siswa tidak bisa memanggil endpoint platform; super admin tak punya profil sponsor", async () => {
  const sp = await sponsorFx();
  const school = await createSchool();
  const adminToken = await webToken((await createSchoolAdmin(school.id)).id);
  const student = await studentFx(school);
  for (const token of [sp.token, adminToken, student.token]) {
    const res = await callRoute<Envelope>(listSponsorsRoute, { method: "GET", url: "/api/v1/platform/sponsors", bearer: token });
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "FORBIDDEN");
  }
  assert.equal((await callRoute(profileGet, { method: "GET", url: "/api/v1/sponsor/profile", bearer: superToken })).status, 403);
  assert.equal((await callRoute(profileGet, { method: "GET", url: "/api/v1/sponsor/profile" })).status, 401);
});
