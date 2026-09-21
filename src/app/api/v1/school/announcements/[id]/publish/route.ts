import { publishAnnouncementContract } from "@/lib/announcements/contracts";
import { publishAnnouncement } from "@/lib/announcements/publish-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(publishAnnouncementContract, async ({ params, query }, ctx) => ({
  data: await publishAnnouncement(ctx, query.schoolId, params.id),
}));
