/**
 * Data demo sponsor & iklan (hanya lewat seed demo: DB *_staging / *_dev / *_test). Dibuat lewat SERVICE domain
 * yang sama dengan API (top-up + persetujuan, banner, iklan + review, klik berbayar lewat jalur ledger) dengan
 * jam dimundurkan sesuai lini masa demo-sponsor-plan.ts, sehingga saldo == ledger dan analitik 14 hari terisi.
 *
 * Idempoten: akun di-upsert berdasarkan email; top-up hanya bila sponsor belum punya top-up; iklan hanya bila
 * judul belum ada; trafik hanya bila sponsor belum punya klik. Masalah storage/aturan -> peringatan.
 */
import sharp from "sharp";
import { createAd } from "../../src/lib/ads/ad-service";
import { uploadBanner } from "../../src/lib/ads/banner-service";
import { recordClick } from "../../src/lib/ads/event-service";
import { getImpressionStore } from "../../src/lib/ads/impression-store";
import { transitionOwnAd } from "../../src/lib/ads/lifecycle-service";
import { approveAd } from "../../src/lib/ads/review-service";
import { createAdBody } from "../../src/lib/ads/schemas";
import { incrementImpressions } from "../../src/lib/ads/stats-repo";
import { signAdToken } from "../../src/lib/ads/token";
import type { ActionContext, Principal } from "../../src/lib/auth/principal";
import { prisma } from "../../src/lib/db";
import { getEnv } from "../../src/lib/env";
import { submitTopUpBody } from "../../src/lib/sponsors/schemas";
import { approveTopUp, submitTopUp } from "../../src/lib/sponsors/topup-service";
import { wibDate } from "../../src/lib/time/zone";
import { withTx } from "../../src/lib/tx";
import { collectDomainWarning, DEMO_SESSION_ID, type DemoSchoolRef } from "./demo-context";
import { DEMO_SUPER_ADMIN } from "./demo-data";
import { demoProofImage, storageProblem } from "./demo-billing";
import { DEMO_ADS, DEMO_PENDING_TOPUP_AMOUNT, DEMO_SPONSOR, DEMO_TOPUP_AMOUNT, demoAdTraffic, demoDeviceType, demoSponsorTimeline, type DemoAdSpec } from "./demo-sponsor-plan";

export interface DemoSponsorSummary {
  readonly email: string;
  readonly balance: number;
  readonly liveAds: number;
  readonly clicks: number;
  readonly warnings: readonly string[];
}

interface Actors {
  readonly sponsorId: string;
  readonly sponsor: Principal;
  readonly admin: Principal;
}

const ctxAt = (principal: Principal, now: Date): ActionContext => ({
  principal, now, requestId: `${DEMO_SESSION_ID}-${now.getTime()}`, ip: null, userAgent: "seed-demo", defer: () => undefined,
});

function principalOf(user: { id: string; name: string }, role: "SPONSOR" | "SUPER_ADMIN", sponsorId: string | null): Principal {
  return {
    userId: user.id, sessionId: DEMO_SESSION_ID, role, name: user.name, schoolId: null, sponsorId, studentId: null, studentStatus: null,
    sponsorStatus: role === "SPONSOR" ? "APPROVED" : null, mustChangePassword: false, platform: "WEB", deviceId: null,
  };
}

/** Sponsor APPROVED + satu akun login (kata sandi = DEMO_PASSWORD), di-upsert berdasarkan email login. */
async function ensureSponsorAccount(passwordHash: string): Promise<Actors> {
  const account = { name: DEMO_SPONSOR.loginName, passwordHash, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null };
  const company = { companyName: DEMO_SPONSOR.companyName, contactName: DEMO_SPONSOR.contactName, contactEmail: DEMO_SPONSOR.email, contactPhone: DEMO_SPONSOR.phone };
  const ids = await withTx(async (tx) => {
    const existing = await tx.user.findFirst({ where: { email: DEMO_SPONSOR.email, role: "SPONSOR" }, select: { id: true, sponsorId: true } });
    if (existing?.sponsorId) {
      await tx.user.update({ where: { id: existing.id }, data: account });
      await tx.sponsor.update({ where: { id: existing.sponsorId }, data: { ...company, status: "APPROVED", statusReason: null } });
      return { userId: existing.id, sponsorId: existing.sponsorId };
    }
    const sponsor = await tx.sponsor.create({ data: { ...company, status: "APPROVED" }, select: { id: true } });
    const user = await tx.user.create({ data: { ...account, role: "SPONSOR", email: DEMO_SPONSOR.email, sponsorId: sponsor.id }, select: { id: true } });
    return { userId: user.id, sponsorId: sponsor.id };
  });
  const admin = await prisma.user.findFirstOrThrow({ where: { email: DEMO_SUPER_ADMIN.email }, select: { id: true, name: true } });
  return {
    sponsorId: ids.sponsorId,
    sponsor: principalOf({ id: ids.userId, name: DEMO_SPONSOR.loginName }, "SPONSOR", ids.sponsorId),
    admin: principalOf(admin, "SUPER_ADMIN", null),
  };
}

async function topUpInput(amount: number, at: Date, seed: number) {
  const bytes = await demoProofImage(seed);
  return submitTopUpBody.parse({
    amount: String(amount), transferDate: wibDate(at), senderName: DEMO_SPONSOR.companyName, senderBank: "BCA",
    file: new File([bytes], "bukti-topup-demo.jpg", { type: "image/jpeg" }),
  });
}

/** Satu top-up disetujui (saldo awal) + satu top-up menunggu verifikasi (antrean super admin). */
async function ensureTopUps(actors: Actors, now: Date): Promise<void> {
  if ((await prisma.topUpRequest.count({ where: { sponsorId: actors.sponsorId } })) > 0) return;
  const t = demoSponsorTimeline(now);
  const approved = await submitTopUp(ctxAt(actors.sponsor, t.topUpAt), await topUpInput(DEMO_TOPUP_AMOUNT, t.topUpAt, 71));
  await approveTopUp(approved.id, ctxAt(actors.admin, t.topUpApprovedAt));
  await submitTopUp(ctxAt(actors.sponsor, now), await topUpInput(DEMO_PENDING_TOPUP_AMOUNT, now, 72));
}

async function demoBanner(rgb: readonly [number, number, number]): Promise<File> {
  const [r, g, b] = rgb;
  const png = await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r, g, b } } })
    .composite([{ input: { create: { width: 1200, height: 140, channels: 3, background: { r: 255, g: 255, b: 255 } } }, top: 440, left: 0 }])
    .png()
    .toBuffer();
  return new File([new Uint8Array(png)], "banner-demo.png", { type: "image/png" });
}

async function ensureAd(actors: Actors, spec: DemoAdSpec, provinceCode: string, now: Date): Promise<string> {
  const existing = await prisma.ad.findFirst({ where: { sponsorId: actors.sponsorId, title: spec.title }, select: { id: true } });
  if (existing) return existing.id;
  const t = demoSponsorTimeline(now);
  const created = ctxAt(actors.sponsor, t.adCreatedAt);
  const banner = await uploadBanner(created, { file: await demoBanner(spec.rgb) });
  const targeting = spec.scope === "ALL" ? { targetScope: "ALL" } : { targetScope: "PROVINCE", targets: { provinceCodes: [provinceCode] } };
  const input = createAdBody.parse({
    title: spec.title, imageFileId: banner.fileId, linkType: "EXTERNAL_URL", targetUrl: spec.targetUrl,
    startAt: t.adStartAt.toISOString(), endAt: t.adEndAt.toISOString(), ...targeting,
  });
  const ad = await createAd(created, input);
  const submitted = await transitionOwnAd(created, ad.id, "submit");
  await approveAd(ad.id, submitted.submittedAt ?? "", ctxAt(actors.admin, t.adApprovedAt));
  return ad.id;
}

type TrafficStudent = { readonly userId: string; readonly schoolId: string };

function studentPrincipal(ref: DemoSchoolRef, student: DemoSchoolRef["students"][number]): Principal {
  return {
    userId: student.userId, sessionId: DEMO_SESSION_ID, role: "STUDENT", name: student.name, schoolId: ref.schoolId, sponsorId: null,
    studentId: student.id, studentStatus: "ACTIVE", sponsorStatus: null, mustChangePassword: false, platform: "ANDROID", deviceId: null,
  };
}

/** Impresi (rollup) + klik lewat jalur klik resmi (ledger CLICK_CHARGE) untuk 14 hari terakhir. */
async function seedTraffic(actors: Actors, adIds: readonly string[], refs: readonly DemoSchoolRef[], provinces: ProvinceMap, now: Date): Promise<void> {
  if ((await prisma.adClick.count({ where: { sponsorId: actors.sponsorId } })) > 0) return;
  const pool = refs.flatMap((ref) => ref.students.map((s) => ({ ref, s })));
  const secret = getEnv().AD_EVENT_SECRET;
  for (const [adIndex, adId] of adIds.entries()) {
    const ad = await prisma.ad.findFirstOrThrow({ where: { id: adId }, select: { targetScope: true, targets: { select: { provinceCode: true } } } });
    const eligible = pool.filter(({ ref }) => ad.targetScope === "ALL" || ad.targets.some((t) => t.provinceCode === provinces.get(ref.schoolId)));
    for (const day of demoAdTraffic(now, adIndex)) {
      await incrementImpressions([{ adId, sponsorId: actors.sponsorId, count: day.impressions }], wibDate(day.at), day.at);
      for (const index of day.clickerIndexes) {
        const pick = eligible[index % Math.max(eligible.length, 1)];
        if (!pick) continue;
        const student: TrafficStudent = { userId: pick.s.userId, schoolId: pick.ref.schoolId };
        const token = await signAdToken({ adId, sponsorId: actors.sponsorId, ...student }, secret, day.at);
        getImpressionStore().record(student.userId, adId, day.at);
        await recordClick(ctxAt(studentPrincipal(pick.ref, pick.s), day.at), { token, deviceType: demoDeviceType(index) });
      }
    }
  }
}

type ProvinceMap = ReadonlyMap<string, string>;

async function loadProvinces(refs: readonly DemoSchoolRef[]): Promise<ProvinceMap> {
  const schools = await prisma.school.findMany({ where: { id: { in: refs.map((r) => r.schoolId) } }, select: { id: true, provinceCode: true } });
  return new Map(schools.map((row) => [row.id, row.provinceCode]));
}

/** Pastikan sponsor demo, top-up, dua iklan tayang, dan trafik analitik 14 hari. */
export async function ensureDemoSponsor(refs: readonly DemoSchoolRef[], passwordHash: string, now: Date): Promise<DemoSponsorSummary> {
  const warnings: string[] = [];
  const actors = await ensureSponsorAccount(passwordHash);
  const provinces = await loadProvinces(refs);
  const firstProvince = provinces.get(refs[0]?.schoolId ?? "") ?? "32";
  const problem = await storageProblem();
  if (problem) {
    warnings.push(`top-up, banner & iklan demo dilewati: STORAGE_ROOT tidak dapat ditulis (${problem})`);
    return summarize(actors.sponsorId, warnings);
  }
  await collectDomainWarning("top-up sponsor demo", warnings, () => ensureTopUps(actors, now));
  const adIds: string[] = [];
  for (const spec of DEMO_ADS) {
    await collectDomainWarning(`iklan demo "${spec.title}"`, warnings, async () => {
      adIds.push(await ensureAd(actors, spec, firstProvince, now));
    });
  }
  await collectDomainWarning("trafik iklan demo", warnings, () => seedTraffic(actors, adIds, refs, provinces, now));
  return summarize(actors.sponsorId, warnings);
}

async function summarize(sponsorId: string, warnings: readonly string[]): Promise<DemoSponsorSummary> {
  const [sponsor, liveAds, clicks] = await Promise.all([
    prisma.sponsor.findFirstOrThrow({ where: { id: sponsorId }, select: { balance: true } }),
    prisma.ad.count({ where: { sponsorId, status: "APPROVED" } }),
    prisma.adClick.count({ where: { sponsorId } }),
  ]);
  return { email: DEMO_SPONSOR.email, balance: sponsor.balance, liveAds, clicks, warnings };
}
