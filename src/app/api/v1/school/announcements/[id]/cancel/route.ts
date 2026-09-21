import { cancelAnnouncementContract } from "@/lib/announcements/contracts";
import { cancelAnnouncement } from "@/lib/announcements/publish-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(cancelAnnouncementContract, async ({ params, query, body }, ctx) => ({
  data: await cancelAnnouncement(ctx, query.schoolId, params.id, body),
}));
