import type { AdLinkType, ClickBilling, DeviceType } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { forbidden } from "@/lib/http/errors";
import { notifySponsorMembers } from "@/lib/notifications/notify";
import { lowBalanceNotification } from "@/lib/notifications/templates/sponsors";
import { LOW_BALANCE_THRESHOLD } from "@/lib/sponsors/constants";
import { appendLedgerEntry, lockSponsor } from "@/lib/sponsors/ledger";
import { detectBalanceAlert } from "@/lib/sponsors/rules";
import { studentSelf } from "@/lib/tenant/scope";
import { toDbDate, wibDate, type LocalDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { adNotFound } from "./ad-queries";
import { isAdRunning, matchesTarget } from "./ad-rules";
import { classifyClick, isNewStudent } from "./click-rules";
import { CLICK_IMPRESSION_WINDOW_MS, CLICK_TX } from "./constants";
import { getImpressionStore } from "./impression-store";
import type { ClickInput, ImpressionsInput } from "./schemas";
import { existingAdSponsors, incrementClickStat, incrementImpressions } from "./stats-repo";
import { verifyAdToken, type AdTokenClaims } from "./token";

/**
 * Impresi (batch, dedupe 30 menit per siswa/iklan, hanya rollup) & klik (dicatat semua; maks 1 DITAGIH per
 * siswa/iklan/hari WIB; SUSPECT tidak ditagih). Penagihan: kunci baris Sponsor PALING AWAL -> baca ulang
 * iklan -> AdClick -> ledger CLICK_CHARGE (CAS saldo, CHECK >= 0) -> AdDailyStat -> notifikasi saldo menipis.
 */
async function verifyOwnToken(token: string, userId: string, schoolId: string, now: Date): Promise<AdTokenClaims | null> {
  const claims = await verifyAdToken(token, getEnv().AD_EVENT_SECRET, now);
  return claims && claims.userId === userId && claims.schoolId === schoolId ? claims : null;
}

export interface ImpressionResult {
  readonly accepted: number;
  readonly duplicate: number;
  readonly rejected: number;
}

/** POST /student/ads/impressions. Token tidak sah dihitung `rejected` (bukan galat seluruh batch). */
export async function recordImpressions(ctx: ActionContext, input: ImpressionsInput): Promise<ImpressionResult> {
  const self = studentSelf(requirePrincipal(ctx));
  const verified = await Promise.all(input.events.map((e) => verifyOwnToken(e.token, self.userId, self.schoolId, ctx.now)));
  const valid = verified.filter((c): c is AdTokenClaims => c !== null);
  const known = await existingAdSponsors([...new Set(valid.map((c) => c.adId))]);
  const store = getImpressionStore();
  const counts = new Map<string, { sponsorId: string; count: number }>();
  let duplicate = 0;
  let rejected = input.events.length - valid.length;
  for (const claims of valid) {
    if (known.get(claims.adId) !== claims.sponsorId) {
      rejected += 1;
      continue;
    }
    if (store.record(self.userId, claims.adId, ctx.now) === "DUPLICATE") {
      duplicate += 1;
      continue;
    }
    const current = counts.get(claims.adId);
    counts.set(claims.adId, { sponsorId: claims.sponsorId, count: (current?.count ?? 0) + 1 });
  }
  const rows = [...counts.entries()].map(([adId, v]) => ({ adId, sponsorId: v.sponsorId, count: v.count }));
  await incrementImpressions(rows, wibDate(ctx.now), ctx.now);
  return { accepted: rows.reduce((sum, r) => sum + r.count, 0), duplicate, rejected };
}

interface ClickContext {
  readonly claims: AdTokenClaims;
  readonly userId: string;
  readonly school: { readonly id: string; readonly provinceCode: string; readonly cityCode: string; readonly isActive: boolean };
  readonly deviceType: DeviceType;
  readonly date: LocalDate;
  readonly recentImpression: boolean;
  readonly newStudent: boolean;
}

export interface ClickOutcome {
  readonly targetUrl: string | null;
  readonly linkType: AdLinkType;
  readonly billing: ClickBilling;
}

async function loadAdForClick(tx: Tx, claims: AdTokenClaims) {
  const ad = await tx.ad.findFirst({
    where: { id: claims.adId, sponsorId: claims.sponsorId },
    select: { status: true, startAt: true, endAt: true, cpcAmount: true, targetUrl: true, linkType: true, targetScope: true, targets: { select: { provinceCode: true, cityCode: true, schoolId: true } } },
  });
  if (!ad) throw adNotFound();
  return ad;
}

async function clickInTx(tx: Tx, c: ClickContext, ctx: ActionContext): Promise<ClickOutcome> {
  const sponsor = await lockSponsor(tx, c.claims.sponsorId);
  const ad = await loadAdForClick(tx, c.claims);
  const running = c.school.isActive && isAdRunning(ad, sponsor.status, ctx.now) && matchesTarget(ad.targetScope, ad.targets, c.school);
  const day = toDbDate(c.date);
  const base = { adId: c.claims.adId, userId: c.userId };
  const [billed, earlier] = await Promise.all([
    tx.adClick.findFirst({ where: { ...base, billableDate: day }, select: { id: true } }),
    tx.adClick.findFirst({ where: { ...base, date: day }, select: { id: true } }),
  ]);
  const billing = classifyClick({ running, billedToday: billed !== null, recentImpression: c.recentImpression, newStudent: c.newStudent, balance: sponsor.balance, cpc: ad.cpcAmount });
  const charged = billing === "CHARGED";
  const click = await tx.adClick.create({
    data: {
      ...base, sponsorId: sponsor.id, schoolId: c.school.id, provinceCode: c.school.provinceCode, cityCode: c.school.cityCode, deviceType: c.deviceType,
      date: day, billing, chargeAmount: charged ? ad.cpcAmount : 0, billableDate: charged ? day : null, createdAt: ctx.now,
    },
    select: { id: true },
  });
  const entry = charged ? await appendLedgerEntry(tx, sponsor, { type: "CLICK_CHARGE", amount: -ad.cpcAmount, adClickId: click.id }, ctx.now) : null;
  await incrementClickStat(tx, { adId: base.adId, sponsorId: sponsor.id, date: c.date, firstToday: earlier === null, charged, spend: charged ? ad.cpcAmount : 0 }, ctx.now);
  const alert = entry ? detectBalanceAlert(sponsor.balance, entry.balanceAfter, LOW_BALANCE_THRESHOLD, ad.cpcAmount) : null;
  if (alert && entry) await notifySponsorMembers(tx, sponsor.id, lowBalanceNotification({ sponsorId: sponsor.id, level: alert, balance: entry.balanceAfter }), ctx);
  return { targetUrl: running ? ad.targetUrl : null, linkType: ad.linkType, billing };
}

/** POST /student/ads/clicks. Token siswa lain / sekolah lain / palsu -> 403 AD_TOKEN_INVALID tanpa baris. */
export async function recordClick(ctx: ActionContext, input: ClickInput): Promise<ClickOutcome> {
  const self = studentSelf(requirePrincipal(ctx));
  const claims = await verifyOwnToken(input.token, self.userId, self.schoolId, ctx.now);
  if (!claims) throw forbidden("AD_TOKEN_INVALID", "Token iklan tidak valid atau kedaluwarsa.");
  const [student, school] = await Promise.all([
    prisma.student.findFirst({ where: { id: self.studentId, schoolId: self.schoolId }, select: { activatedAt: true } }),
    prisma.school.findFirst({ where: { id: self.schoolId }, select: { id: true, provinceCode: true, cityCode: true, isActive: true } }),
  ]);
  if (!student || !school) throw forbidden("AD_TOKEN_INVALID", "Token iklan tidak valid atau kedaluwarsa.");
  const clickCtx: ClickContext = {
    claims, userId: self.userId, school, deviceType: input.deviceType, date: wibDate(ctx.now),
    recentImpression: getImpressionStore().seenWithin(self.userId, claims.adId, ctx.now, CLICK_IMPRESSION_WINDOW_MS),
    newStudent: isNewStudent(student.activatedAt, ctx.now),
  };
  return withTx((tx) => clickInTx(tx, clickCtx, ctx), CLICK_TX);
}

/** Respons klik untuk app: tanpa informasi penagihan. */
export async function clickResponse(ctx: ActionContext, input: ClickInput): Promise<{ targetUrl: string | null; linkType: AdLinkType }> {
  const { targetUrl, linkType } = await recordClick(ctx, input);
  return { targetUrl, linkType };
}
