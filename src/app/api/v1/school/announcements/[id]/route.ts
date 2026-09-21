import { deleteAnnouncementContract, getAnnouncementContract, updateAnnouncementContract } from "@/lib/announcements/contracts";
import { getAnnouncement } from "@/lib/announcements/queries";
import { deleteAnnouncement, updateAnnouncement } from "@/lib/announcements/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getAnnouncementContract, async ({ params, query }, ctx) => ({
  data: await getAnnouncement(ctx, query.schoolId, params.id),
}));
export const PATCH = defineRoute(updateAnnouncementContract, async ({ params, query, body }, ctx) => ({
  data: await updateAnnouncement(ctx, query.schoolId, params.id, body),
}));
export const DELETE = defineRoute(deleteAnnouncementContract, async ({ params, query }, ctx) => ({
  data: await deleteAnnouncement(ctx, query.schoolId, params.id),
}));
