import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { notifySponsorMembers } from "@/lib/notifications/notify";
import { sponsorApprovedNotification, sponsorSuspendedNotification } from "@/lib/notifications/templates/sponsors";
import { planCredential } from "@/lib/users/rules";
import { withTx } from "@/lib/tx";
import { failSponsor, sponsorViolation } from "./errors";
import { lockSponsor } from "./ledger";
import { getSponsorDto } from "./queries";
import type { SponsorDto } from "./response-schemas";
import { nextSponsorStatus, type SponsorAction } from "./rules";
import type { CreateSponsorInput, UpdateOwnProfileInput, UpdateSponsorInput } from "./schemas";

/**
 * Akun sponsor oleh super admin (buat + login pertama, ubah data, setujui/tangguhkan/aktifkan kembali) dan
 * profil milik sponsor. Transisi status = Sponsor FOR UPDATE -> aturan murni -> update -> notifikasi anggota
 * -> audit (satu transaksi). Penangguhan TIDAK mengubah baris iklan: penayangan & penagihan memeriksa
 * status sponsor saat berjalan, sehingga pengaktifan kembali memulihkan semuanya.
 */
const emailTaken = () => conflict("EMAIL_TAKEN", "Email sudah dipakai akun lain.");

function mapEmailRace(error: unknown): never {
  if ((error as { code?: unknown } | null)?.code === "P2002") throw emailTaken();
  throw error;
}

export interface CreatedSponsor {
  readonly sponsor: SponsorDto;
  readonly userId: string;
  readonly temporaryPassword?: string;
}

/** POST /platform/sponsors: Sponsor PENDING (saldo 0) + akun SPONSOR wajib ganti kata sandi. */
export async function createSponsorAccount(input: CreateSponsorInput, ctx: ActionContext): Promise<CreatedSponsor> {
  const plan = planCredential(input.login.initialPassword, { email: input.login.email }, ctx.now);
  const holder = await prisma.user.findFirst({ where: { email: input.login.email }, select: { id: true } });
  if (holder) throw emailTaken();
  const passwordHash = await hashPassword(plan.plain, plan.cost);
  const created = await withTx(async (tx) => {
    const sponsor = await tx.sponsor.create({
      data: {
        companyName: input.companyName, contactName: input.contactName, contactEmail: input.contactEmail, contactPhone: input.contactPhone,
        address: input.address ?? null, status: "PENDING", createdAt: ctx.now,
      },
      select: { id: true },
    });
    const user = await tx.user.create({
      data: {
        role: "SPONSOR", name: input.login.name, email: input.login.email, sponsorId: sponsor.id, passwordHash,
        mustChangePassword: true, tempPasswordExpiresAt: plan.tempPasswordExpiresAt,
      },
      select: { id: true },
    });
    const after = { companyName: input.companyName, contactEmail: input.contactEmail, loginEmail: input.login.email, userId: user.id, credential: plan.kind };
    await writeAudit(tx, { action: "sponsor.create", entityType: "Sponsor", entityId: sponsor.id, after }, ctx);
    return { sponsorId: sponsor.id, userId: user.id };
  }).catch(mapEmailRace);
  const sponsor = await getSponsorDto(prisma, created.sponsorId);
  return plan.kind === "GENERATED" ? { sponsor, userId: created.userId, temporaryPassword: plan.plain } : { sponsor, userId: created.userId };
}

/** PATCH /platform/sponsors/{id}: data perusahaan & kontak (diaudit). */
export async function updateSponsor(sponsorId: string, input: UpdateSponsorInput, ctx: ActionContext): Promise<SponsorDto> {
  await withTx(async (tx) => {
    await lockSponsor(tx, sponsorId);
    const before = await getSponsorDto(tx, sponsorId);
    await tx.sponsor.update({ where: { id: sponsorId }, data: input });
    await writeAudit(tx, { action: "sponsor.update", entityType: "Sponsor", entityId: sponsorId, before, after: input }, ctx);
  });
  return getSponsorDto(prisma, sponsorId);
}

const TRANSITION_AUDIT: Readonly<Record<SponsorAction, string>> = {
  approve: "sponsor.approve",
  suspend: "sponsor.suspend",
  reactivate: "sponsor.reactivate",
};

/** approve (PENDING->APPROVED), suspend (PENDING|APPROVED->SUSPENDED, alasan wajib), reactivate (SUSPENDED->APPROVED). */
export async function transitionSponsor(sponsorId: string, action: SponsorAction, reason: string | null, ctx: ActionContext): Promise<SponsorDto> {
  const actor = requirePrincipal(ctx);
  await withTx(async (tx) => {
    const locked = await lockSponsor(tx, sponsorId);
    const next = nextSponsorStatus(locked.status, action);
    if (!next) failSponsor(sponsorViolation("SPONSOR_INVALID_TRANSITION", "Perubahan status sponsor tidak diizinkan dari status saat ini.", { status: locked.status, action }));
    await tx.sponsor.update({
      where: { id: sponsorId },
      data: { status: next, statusReason: action === "suspend" ? reason : null, reviewedById: actor.userId, reviewedAt: ctx.now },
    });
    const event = action === "suspend"
      ? sponsorSuspendedNotification({ sponsorId, reason: reason ?? "-" })
      : sponsorApprovedNotification({ sponsorId, reactivated: action === "reactivate" });
    await notifySponsorMembers(tx, sponsorId, event, ctx);
    const audit = { before: { status: locked.status }, after: { status: next, reason } };
    await writeAudit(tx, { action: TRANSITION_AUDIT[action], entityType: "Sponsor", entityId: sponsorId, ...audit }, ctx);
  });
  return getSponsorDto(prisma, sponsorId);
}

/** PATCH /sponsor/profile: kontak milik sendiri (nama perusahaan & email kontak hanya super admin). */
export async function updateOwnProfile(sponsorId: string, input: UpdateOwnProfileInput, ctx: ActionContext): Promise<SponsorDto> {
  await withTx(async (tx) => {
    await lockSponsor(tx, sponsorId);
    const before = await getSponsorDto(tx, sponsorId);
    await tx.sponsor.update({ where: { id: sponsorId }, data: input });
    const after = { contactName: input.contactName, contactPhone: input.contactPhone, address: input.address };
    await writeAudit(tx, { action: "sponsor.profile.update", entityType: "Sponsor", entityId: sponsorId, before, after }, ctx);
  });
  return getSponsorDto(prisma, sponsorId);
}
