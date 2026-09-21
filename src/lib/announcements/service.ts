import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import type { SchoolScope } from "@/lib/tenant/scope";
import { withTx } from "@/lib/tx";
import { AUDIT_ENTITY } from "./constants";
import { audienceOf } from "./dto";
import { publishLocked } from "./publish-service";
import { loadAnnouncementDetail } from "./queries";
import {
  announcementScopeOf,
  assertAction,
  assertSchoolExists,
  assertTargetsInSchool,
  lockAnnouncement,
  stateConflict,
  targetRows,
  type LockedAnnouncement,
} from "./records";
import { normalizeAudience, type NormalizedAudience } from "./rules";
import type { AnnouncementDetailDto, CreateAnnouncementInput, UpdateAnnouncementInput } from "./schemas";

/**
 * Buat, ubah (draf saja), dan hapus (draf saja) pengumuman. Mutasi baris yang sudah ada selalu
 * mengunci Announcement FOR UPDATE lebih dulu lalu CAS `status = DRAFT`; audit di transaksi yang sama.
 */

function auditSnapshot(fields: { category: string; title: string; audience: string }, audience: NormalizedAudience) {
  return { category: fields.category, title: fields.title, audience: fields.audience, classIds: audience.classIds, studentIds: audience.studentIds };
}

async function replaceTargets(tx: Tx, announcementId: string, audience: NormalizedAudience): Promise<void> {
  await tx.announcementTarget.deleteMany({ where: { announcementId } });
  const rows = targetRows(announcementId, audience);
  if (rows.length > 0) await tx.announcementTarget.createMany({ data: rows });
}

/** Draf baru; publishNow = terbitkan di transaksi yang sama (0 penerima -> 422 dan draf ikut batal). */
export async function createAnnouncement(ctx: ActionContext, schoolId: string | undefined, input: CreateAnnouncementInput): Promise<AnnouncementDetailDto> {
  const principal = requirePrincipal(ctx);
  const scope = announcementScopeOf(ctx, schoolId);
  const audience = normalizeAudience(input);
  return withTx(async (tx) => {
    await assertSchoolExists(tx, scope);
    await assertTargetsInSchool(tx, scope.schoolId, audience);
    const created = await tx.announcement.create({
      data: { schoolId: scope.schoolId, authorId: principal.userId, category: input.category, title: input.title, body: input.body, audience: audience.audience },
      select: { id: true },
    });
    await replaceTargets(tx, created.id, audience);
    if (input.publishNow) await publishLocked(tx, await lockAnnouncement(tx, scope, created.id), ctx);
    await writeAudit(
      tx,
      { action: "announcement.create", entityType: AUDIT_ENTITY, entityId: created.id, schoolId: scope.schoolId, after: { ...auditSnapshot(input, audience), publishNow: input.publishNow } },
      ctx,
    );
    return loadAnnouncementDetail(tx, scope, created.id);
  });
}

function patchData(input: UpdateAnnouncementInput): Prisma.AnnouncementUpdateManyMutationInput {
  return {
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
  };
}

async function applyPatch(tx: Tx, scope: SchoolScope, row: LockedAnnouncement, input: UpdateAnnouncementInput, ctx: ActionContext): Promise<void> {
  const before = normalizeAudience(audienceOf(row));
  const audience = input.audience ? normalizeAudience({ audience: input.audience, classIds: input.classIds, studentIds: input.studentIds }) : before;
  if (input.audience) {
    await assertTargetsInSchool(tx, scope.schoolId, audience);
    await replaceTargets(tx, row.id, audience);
  }
  const cas = await tx.announcement.updateMany({ where: { id: row.id, schoolId: scope.schoolId, status: "DRAFT" }, data: patchData(input) });
  if (cas.count !== 1) throw stateConflict();
  const after = { category: input.category ?? row.category, title: input.title ?? row.title, audience: audience.audience };
  await writeAudit(
    tx,
    {
      action: "announcement.update",
      entityType: AUDIT_ENTITY,
      entityId: row.id,
      schoolId: scope.schoolId,
      before: auditSnapshot(row, before),
      after: { ...auditSnapshot(after, audience), bodyChanged: input.body !== undefined && input.body !== row.body },
    },
    ctx,
  );
}

export async function updateAnnouncement(
  ctx: ActionContext,
  schoolId: string | undefined,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementDetailDto> {
  const scope = announcementScopeOf(ctx, schoolId);
  return withTx(async (tx) => {
    const row = await lockAnnouncement(tx, scope, id);
    assertAction(row, "edit");
    await applyPatch(tx, scope, row, input, ctx);
    return loadAnnouncementDetail(tx, scope, id);
  });
}

/** Hapus permanen draf (target ikut terhapus kaskade). Selain DRAF -> 409 ANNOUNCEMENT_NOT_DRAFT. */
export async function deleteAnnouncement(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<{ id: string; deleted: true }> {
  const scope = announcementScopeOf(ctx, schoolId);
  return withTx(async (tx) => {
    const row = await lockAnnouncement(tx, scope, id);
    assertAction(row, "delete");
    const removed = await tx.announcement.deleteMany({ where: { id, schoolId: scope.schoolId, status: "DRAFT" } });
    if (removed.count !== 1) throw stateConflict();
    await writeAudit(
      tx,
      { action: "announcement.delete", entityType: AUDIT_ENTITY, entityId: id, schoolId: scope.schoolId, before: auditSnapshot(row, normalizeAudience(audienceOf(row))) },
      ctx,
    );
    return { id, deleted: true as const };
  });
}
