import { createAnnouncementContract, listAnnouncementsContract } from "@/lib/announcements/contracts";
import { listAnnouncements } from "@/lib/announcements/queries";
import { createAnnouncement } from "@/lib/announcements/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listAnnouncementsContract, async ({ query }, ctx) => listAnnouncements(ctx, query));
export const POST = defineRoute(createAnnouncementContract, async ({ query, body }, ctx) => ({
  data: await createAnnouncement(ctx, query.schoolId, body),
  status: 201,
}));
