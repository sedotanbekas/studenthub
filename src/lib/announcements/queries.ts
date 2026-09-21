import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import { ANNOUNCEMENT_DETAIL_SELECT, ANNOUNCEMENT_LIST_SELECT, toAnnouncementDetailDto, toAnnouncementListItemDto } from "./dto";
import { announcementNotFound, announcementScopeOf, assertSchoolExists, assertTargetsInSchool, countRecipients } from "./records";
import { normalizeAudience } from "./rules";
import type { AnnouncementDetailDto, AnnouncementListItemDto, ListAnnouncementsQuery, RecipientPreviewInput } from "./schemas";

/** Query baca pengumuman admin (selalu ber-scope sekolah & ber-take). */

function listWhere(scope: SchoolScope, query: ListAnnouncementsQuery): Prisma.AnnouncementWhereInput {
  const q = likeSearch(query.q);
  return {
    schoolId: scope.schoolId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(q ? { title: { contains: q } } : {}),
  };
}

export async function listAnnouncements(
  ctx: ActionContext,
  query: ListAnnouncementsQuery,
): Promise<{ data: AnnouncementListItemDto[]; meta: PageMeta }> {
  const scope = announcementScopeOf(ctx, query.schoolId);
  await assertSchoolExists(prisma, scope);
  const where = listWhere(scope, query);
  const [total, rows] = await Promise.all([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...toSkipTake(query), select: ANNOUNCEMENT_LIST_SELECT }),
  ]);
  return { data: rows.map(toAnnouncementListItemDto), meta: pageMeta(total, query.page, query.limit) };
}

/** Detail + target bernama + statistik baca (readCount hanya di detail, desain 05 A9). */
export async function loadAnnouncementDetail(db: Tx, scope: SchoolScope, id: string): Promise<AnnouncementDetailDto> {
  const row = await db.announcement.findFirst({ where: { id, schoolId: scope.schoolId }, select: ANNOUNCEMENT_DETAIL_SELECT });
  if (!row) throw announcementNotFound();
  const readCount = await db.notification.count({ where: { announcementId: row.id, readAt: { not: null } } });
  return toAnnouncementDetailDto(row, readCount);
}

export async function getAnnouncement(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<AnnouncementDetailDto> {
  return loadAnnouncementDetail(prisma, announcementScopeOf(ctx, schoolId), id);
}

/** Pratinjau jumlah penerima: query yang sama dengan resolusi penerima saat terbit (desain 05 A6). */
export async function previewRecipients(ctx: ActionContext, schoolId: string | undefined, input: RecipientPreviewInput): Promise<{ count: number }> {
  const scope = announcementScopeOf(ctx, schoolId);
  await assertSchoolExists(prisma, scope);
  const audience = normalizeAudience(input);
  await assertTargetsInSchool(prisma, scope.schoolId, audience);
  return { count: await countRecipients(prisma, scope.schoolId, audience) };
}
