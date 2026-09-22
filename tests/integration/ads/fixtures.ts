/**
 * Fixture integrasi sponsor & iklan: akun sponsor/super admin/siswa bertoken, banner uji, pembuatan iklan
 * sampai LIVE lewat route asli (unggah -> draf -> submit -> approve), pengisian saldo lewat jalur ledger resmi,
 * serta pemanggil route siswa (tayang, impresi, klik). DB test dipakai ulang tanpa reset -> data unik.
 */
import { NextRequest } from "next/server";
import sharp from "sharp";
import type { School, SponsorStatus } from "@prisma/client";
import { POST as approveAdRoute } from "@/app/api/v1/platform/ads/[id]/approve/route";
import { POST as submitAdRoute } from "@/app/api/v1/sponsor/ads/[id]/submit/route";
import { POST as createAdRoute } from "@/app/api/v1/sponsor/ads/route";
import { POST as bannerRoute } from "@/app/api/v1/sponsor/banners/route";
import { POST as clickRoute } from "@/app/api/v1/student/ads/clicks/route";
import { POST as impressionRoute } from "@/app/api/v1/student/ads/impressions/route";
import { GET as serveRoute } from "@/app/api/v1/student/ads/route";
import { getImpressionStore } from "@/lib/ads/impression-store";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { appendLedgerEntry, lockSponsor } from "@/lib/sponsors/ledger";
import { wibDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { prisma } from "../helpers/db";
import { createSchool, createSponsor, createStudent, createSuperAdmin, type CreateSchoolOptions, type CreateStudentOptions, type TestStudent, type TestUser } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope } from "../helpers/request";

export const todayWib = (): string => wibDate(new Date());
const HOUR = 3_600_000;
const DAY = 86_400_000;

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export interface SponsorFx {
  readonly sponsorId: string;
  readonly user: TestUser;
  readonly token: string;
}

export async function sponsorFx(status: SponsorStatus = "APPROVED"): Promise<SponsorFx> {
  const { sponsor, user } = await createSponsor({ status });
  return { sponsorId: sponsor.id, user, token: await webToken(user.id) };
}

export async function superFx(): Promise<{ user: TestUser; token: string }> {
  const user = await createSuperAdmin();
  return { user, token: await webToken(user.id) };
}

/** Isi saldo lewat jalur ledger resmi (ADJUSTMENT) agar invarian saldo == ledger tetap terjaga. */
export async function fund(sponsorId: string, amount: number): Promise<void> {
  await withTx(async (tx) => {
    const locked = await lockSponsor(tx, sponsorId);
    await appendLedgerEntry(tx, locked, { type: "ADJUSTMENT", amount, note: "dana uji" }, new Date());
  });
}

let bannerSeed = Math.floor(Math.random() * 100_000);

/** Banner uji berpola acak (PNG) dengan ukuran tertentu. */
export async function bannerBlob(width = 1200, height = 600): Promise<Blob> {
  bannerSeed += 1;
  const size = 8;
  let state = (bannerSeed * 2_654_435_761) % 4_294_967_296 || 1;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % 256;
  };
  const raw = Buffer.from(Array.from({ length: size * size * 3 }, next));
  const png = await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).resize(width, height, { kernel: "nearest", fit: "fill" }).png().toBuffer();
  return new Blob([new Uint8Array(png)], { type: "image/png" });
}

/** Multipart dengan Content-Length eksplisit (readMultipart mewajibkannya) + parameter path opsional. */
export async function callMultipart<T = Envelope>(
  handler: AnyRouteHandler,
  options: { url: string; form: FormData; bearer?: string; params?: Record<string, string> },
): Promise<{ status: number; body: T | null }> {
  const encoded = new Request("http://localhost/encode", { method: "POST", body: options.form });
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type") ?? "", "content-length": String(body.byteLength) });
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  const request = new NextRequest(new URL(options.url, "http://localhost"), { method: "POST", headers, body });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) as Promise<never> });
  const text = response.headers.get("content-type")?.includes("json") ? await response.text() : "";
  return { status: response.status, body: text ? (JSON.parse(text) as T) : null };
}

export async function uploadBanner(token: string, blob?: Blob): Promise<{ status: number; body: Envelope<{ fileId: string; width: number; height: number }> | null }> {
  const form = new FormData();
  form.set("file", blob ?? (await bannerBlob()), "banner.png");
  return callMultipart(bannerRoute, { url: "/api/v1/sponsor/banners", form, bearer: token });
}

export async function bannerId(token: string): Promise<string> {
  const res = await uploadBanner(token);
  if (res.status !== 201 || !res.body) throw new Error(`unggah banner gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data.fileId;
}

export interface AdBody {
  readonly id: string;
  readonly status: string;
  readonly displayStatus: string;
  readonly isActive: boolean;
  readonly cpcAmount: number;
  readonly submittedAt: string | null;
  readonly imageFileId: string;
  readonly imageUrl: string | null;
  readonly targetUrl: string;
  readonly updatedAt: string;
  readonly targets: Array<{ provinceCode: string | null; cityCode: string | null; schoolId: string | null; label: string }>;
}

export function adInput(imageFileId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    title: "Promo Uji",
    imageFileId,
    linkType: "EXTERNAL_URL",
    targetUrl: "https://promo.example.co.id/diskon",
    startAt: new Date(now - HOUR).toISOString(),
    endAt: new Date(now + 30 * DAY).toISOString(),
    targetScope: "ALL",
    ...overrides,
  };
}

export async function createDraft(token: string, imageFileId: string, overrides: Record<string, unknown> = {}): Promise<AdBody> {
  const res = await callRoute<Envelope<AdBody>>(createAdRoute, { method: "POST", url: "/api/v1/sponsor/ads", bearer: token, json: adInput(imageFileId, overrides) });
  if (res.status !== 201 || !res.body) throw new Error(`buat draf gagal ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

export async function submitAd(token: string, id: string) {
  return callRoute<Envelope<AdBody>>(submitAdRoute, { method: "POST", url: `/api/v1/sponsor/ads/${id}/submit`, params: { id }, bearer: token });
}

export async function approveAd(token: string, id: string, submittedAt: string) {
  return callRoute<Envelope<AdBody>>(approveAdRoute, { method: "POST", url: `/api/v1/platform/ads/${id}/approve`, params: { id }, bearer: token, json: { submittedAt } });
}

/** Iklan APPROVED (LIVE bila sponsor bersaldo >= CPC). */
export async function liveAd(sp: SponsorFx, superToken: string, overrides: Record<string, unknown> = {}): Promise<AdBody> {
  const draft = await createDraft(sp.token, await bannerId(sp.token), overrides);
  const submitted = await submitAd(sp.token, draft.id);
  if (submitted.status !== 200 || !submitted.body?.data.submittedAt) throw new Error(`submit gagal ${submitted.status}: ${JSON.stringify(submitted.body)}`);
  const approved = await approveAd(superToken, draft.id, submitted.body.data.submittedAt);
  if (approved.status !== 200 || !approved.body) throw new Error(`approve gagal ${approved.status}: ${JSON.stringify(approved.body)}`);
  return approved.body.data;
}

export interface StudentFx extends TestStudent {
  readonly school: School;
  readonly token: string;
}

export async function studentFx(school?: School, options: CreateStudentOptions = {}, schoolOptions: CreateSchoolOptions = {}): Promise<StudentFx> {
  const target = school ?? (await createSchool(schoolOptions));
  const created = await createStudent(target.id, options);
  return { ...created, school: target, token: (await createSessionToken(created.user.id)).token };
}

export interface ServedBody {
  readonly ads: Array<{ token: string; adId: string; title: string; imageUrl: string; targetUrl: string; sponsorName: string }>;
  readonly refreshAfterSeconds: number;
}

export async function serve(token: string) {
  return callRoute<Envelope<ServedBody>>(serveRoute, { method: "GET", url: "/api/v1/student/ads", bearer: token });
}

export async function servedTokenFor(student: StudentFx, adId: string): Promise<string> {
  const res = await serve(student.token);
  const ad = res.body?.data.ads.find((a) => a.adId === adId);
  if (!ad) throw new Error(`iklan ${adId} tidak ditayangkan ke siswa: ${JSON.stringify(res.body)}`);
  return ad.token;
}

export async function impress(token: string, adTokens: readonly string[]) {
  return callRoute<Envelope<{ accepted: number; duplicate: number; rejected: number }>>(impressionRoute, {
    method: "POST", url: "/api/v1/student/ads/impressions", bearer: token, json: { events: adTokens.map((t) => ({ token: t })) },
  });
}

export async function click(token: string, adToken: string, deviceType?: string) {
  return callRoute<Envelope<{ targetUrl: string | null; linkType: string }>>(clickRoute, {
    method: "POST", url: "/api/v1/student/ads/clicks", bearer: token, json: { token: adToken, ...(deviceType ? { deviceType } : {}) },
  });
}

/** Siswa melihat iklan (impresi) lalu mengklik. */
export async function viewAndClick(student: StudentFx, adId: string, deviceType?: string) {
  const adToken = await servedTokenFor(student, adId);
  await impress(student.token, [adToken]);
  return click(student.token, adToken, deviceType);
}

export function resetEventState(): void {
  getImpressionStore().clear();
  resetAllLimiters();
}

/** Invarian uang: saldo cache == balanceAfter entri terakhir == jumlah semua entri ledger. */
export async function ledgerInvariant(sponsorId: string): Promise<{ balance: number; sum: number; last: number }> {
  const [sponsor, agg, last] = await Promise.all([
    prisma.sponsor.findFirstOrThrow({ where: { id: sponsorId }, select: { balance: true } }),
    prisma.sponsorLedgerEntry.aggregate({ where: { sponsorId }, _sum: { amount: true } }),
    prisma.sponsorLedgerEntry.findFirst({ where: { sponsorId }, orderBy: { seq: "desc" }, select: { balanceAfter: true } }),
  ]);
  return { balance: sponsor.balance, sum: agg._sum.amount ?? 0, last: last?.balanceAfter ?? 0 };
}

/**
 * Isolasi penayangan pada DB test yang dipakai ulang: jeda semua iklan APPROVED sisa berkas/run lain (mis. cakupan
 * ALL atau provinsi default factory) agar slider hanya berisi iklan milik test ini. Hanya untuk DB *_test.
 */
export async function isolateServing(): Promise<void> {
  await prisma.ad.updateMany({ where: { status: "APPROVED" }, data: { status: "PAUSED" } });
}

export const schoolTarget = (schoolId: string): Record<string, unknown> => ({ targetScope: "SCHOOL", targets: { schoolIds: [schoolId] } });
