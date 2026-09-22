import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { forbidden } from "@/lib/http/errors";
import { notifySponsorMembers, notifySuperAdmins } from "@/lib/notifications/notify";
import { topUpApprovedNotification, topUpRejectedNotification, topUpSubmittedNotification } from "@/lib/notifications/templates/sponsors";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile } from "@/lib/storage/files";
import { processImage, type ProcessedImage } from "@/lib/storage/image";
import { resolveSponsorScope } from "@/lib/tenant/scope";
import { toDbDate, wibDate } from "@/lib/time/zone";
import { lockRows, withTx } from "@/lib/tx";
import { assertSponsorRule, failSponsor, sponsorViolation } from "./errors";
import { appendLedgerEntry, lockSponsor, type LockedSponsor } from "./ledger";
import type { LedgerEntryDto, PlatformTopUpDto, TopUpDto } from "./response-schemas";
import { topUpViolation } from "./rules";
import type { SubmitTopUpInput } from "./schemas";
import { getAdSettings } from "./settings-service";
import { getOwnTopUp, getPlatformTopUp, topUpNotFound } from "./topup-queries";

/**
 * Top-up saldo: sponsor APPROVED mengunggah bukti (multipart atomik), super admin menyetujui (CAS PENDING ->
 * APPROVED + entri ledger TOPUP) atau menolak (alasan wajib). Urutan kunci: Sponsor -> TopUpRequest;
 * Notification & AuditLog terakhir. Persetujuan tetap boleh saat sponsor ditangguhkan (uang sudah diterima).
 */
const alreadyReviewed = (status: string) =>
  failSponsor(sponsorViolation("TOPUP_ALREADY_REVIEWED", "Pengajuan top-up ini sudah ditinjau atau dibatalkan.", { status }));

async function assessTopUp(db: Tx, sponsorId: string, input: SubmitTopUpInput, now: Date): Promise<void> {
  const [settings, pendingCount] = await Promise.all([getAdSettings(db), db.topUpRequest.count({ where: { sponsorId, status: "PENDING" } })]);
  assertSponsorRule(topUpViolation({ amount: input.amount, transferDate: input.transferDate, pendingCount }, settings, wibDate(now)));
}

function assertApprovedUnderLock(locked: LockedSponsor): void {
  if (locked.status === "APPROVED") return;
  throw locked.status === "SUSPENDED"
    ? forbidden("SPONSOR_SUSPENDED", "Akun sponsor ditangguhkan.")
    : forbidden("SPONSOR_NOT_APPROVED", "Akun sponsor belum disetujui.");
}

interface TopUpWork {
  readonly sponsorId: string;
  readonly userId: string;
  readonly input: SubmitTopUpInput;
  readonly processed: ProcessedImage;
}

async function insertTopUp(tx: Tx, work: TopUpWork, written: string[], ctx: ActionContext): Promise<string> {
  const locked = await lockSponsor(tx, work.sponsorId);
  assertApprovedUnderLock(locked);
  await assessTopUp(tx, work.sponsorId, work.input, ctx.now);
  const file = await persistProcessedFile(
    tx,
    { kind: "TOPUP_PROOF", processed: work.processed, uploadedById: work.userId, sponsorId: work.sponsorId, bucket: "private", attachedAt: ctx.now, originalName: work.input.file.name },
    ctx.now,
  );
  written.push(file.storageKey);
  const { input } = work;
  const topUp = await tx.topUpRequest.create({
    data: {
      sponsorId: work.sponsorId, amount: input.amount, transferDate: toDbDate(input.transferDate), senderName: input.senderName,
      senderBank: input.senderBank, note: input.note ?? null, proofFileId: file.id, createdAt: ctx.now,
    },
    select: { id: true },
  });
  await notifySuperAdmins(tx, topUpSubmittedNotification({ topUpId: topUp.id, companyName: locked.companyName, amount: input.amount }), ctx);
  return topUp.id;
}

/** POST /sponsor/topups (multipart). Berkas di disk dibuang bila transaksi gagal (tanpa yatim). */
export async function submitTopUp(ctx: ActionContext, input: SubmitTopUpInput): Promise<TopUpDto> {
  const principal = requirePrincipal(ctx);
  const { sponsorId } = resolveSponsorScope(principal);
  await assessTopUp(prisma, sponsorId, input, ctx.now);
  await assertDiskSpace(storageRoot());
  const processed = await processImage(new Uint8Array(await input.file.arrayBuffer()), "TOPUP_PROOF");
  const written: string[] = [];
  try {
    const id = await withTx((tx) => insertTopUp(tx, { sponsorId, userId: principal.userId, input, processed }, written, ctx));
    await Promise.all(written.slice(0, -1).map(discardFile));
    return getOwnTopUp(prisma, sponsorId, id);
  } catch (error) {
    await Promise.all(written.map(discardFile));
    throw error;
  }
}

/** POST /sponsor/topups/{id}/cancel: CAS PENDING -> CANCELLED milik sendiri. */
export async function cancelOwnTopUp(ctx: ActionContext, id: string): Promise<TopUpDto> {
  const { sponsorId } = resolveSponsorScope(requirePrincipal(ctx));
  const own = await prisma.topUpRequest.findFirst({ where: { id, sponsorId }, select: { status: true } });
  if (!own) throw topUpNotFound();
  await withTx(async (tx) => {
    await lockSponsor(tx, sponsorId);
    const updated = await tx.topUpRequest.updateMany({ where: { id, sponsorId, status: "PENDING" }, data: { status: "CANCELLED", updatedAt: ctx.now } });
    if (updated.count !== 1) alreadyReviewed(own.status);
  });
  return getOwnTopUp(prisma, sponsorId, id);
}

async function lockReview(tx: Tx, id: string): Promise<{ locked: LockedSponsor; amount: number }> {
  const target = await tx.topUpRequest.findFirst({ where: { id }, select: { sponsorId: true } });
  if (!target) throw topUpNotFound();
  const locked = await lockSponsor(tx, target.sponsorId);
  await lockRows(tx, "TopUpRequest", [id]);
  const row = await tx.topUpRequest.findFirst({ where: { id }, select: { status: true, amount: true } });
  if (!row) throw topUpNotFound();
  if (row.status !== "PENDING") alreadyReviewed(row.status);
  return { locked, amount: row.amount };
}

async function markReviewed(tx: Tx, id: string, status: "APPROVED" | "REJECTED", note: string | null, ctx: ActionContext): Promise<void> {
  const data = { status, reviewNote: note, reviewedById: requirePrincipal(ctx).userId, reviewedAt: ctx.now, updatedAt: ctx.now };
  const updated = await tx.topUpRequest.updateMany({ where: { id, status: "PENDING" }, data });
  if (updated.count !== 1) alreadyReviewed("UNKNOWN");
}

/** POST /platform/topups/{id}/approve: kredit tepat sebesar nominal pengajuan (salah nominal = tolak & ajukan ulang). */
export async function approveTopUp(id: string, ctx: ActionContext): Promise<{ topUp: PlatformTopUpDto; ledgerEntry: LedgerEntryDto }> {
  const actor = requirePrincipal(ctx);
  const ledgerEntry = await withTx(async (tx): Promise<LedgerEntryDto> => {
    const { locked, amount } = await lockReview(tx, id);
    await markReviewed(tx, id, "APPROVED", null, ctx);
    const entry = await appendLedgerEntry(tx, locked, { type: "TOPUP", amount, topUpRequestId: id, createdById: actor.userId }, ctx.now);
    await notifySponsorMembers(tx, locked.id, topUpApprovedNotification({ topUpId: id, amount, balance: entry.balanceAfter }), ctx);
    const audit = { before: { status: "PENDING", balance: locked.balance }, after: { status: "APPROVED", balance: entry.balanceAfter, amount } };
    await writeAudit(tx, { action: "topup.approve", entityType: "TopUpRequest", entityId: id, ...audit }, ctx);
    return {
      id: entry.id, seq: entry.seq, type: "TOPUP", amount, balanceAfter: entry.balanceAfter, note: null, topUpRequestId: id, adId: null,
      createdAt: entry.createdAt.toISOString(),
    };
  });
  return { topUp: await getPlatformTopUp(prisma, id), ledgerEntry };
}

/** POST /platform/topups/{id}/reject: alasan wajib, sponsor diberi tahu. */
export async function rejectTopUp(id: string, reason: string, ctx: ActionContext): Promise<PlatformTopUpDto> {
  await withTx(async (tx) => {
    const { locked, amount } = await lockReview(tx, id);
    await markReviewed(tx, id, "REJECTED", reason, ctx);
    await notifySponsorMembers(tx, locked.id, topUpRejectedNotification({ topUpId: id, amount, reason }), ctx);
    await writeAudit(tx, { action: "topup.reject", entityType: "TopUpRequest", entityId: id, before: { status: "PENDING" }, after: { status: "REJECTED", reason } }, ctx);
  });
  return getPlatformTopUp(prisma, id);
}
