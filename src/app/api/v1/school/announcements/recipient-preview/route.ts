import { previewAnnouncementRecipientsContract } from "@/lib/announcements/contracts";
import { previewRecipients } from "@/lib/announcements/queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(previewAnnouncementRecipientsContract, async ({ query, body }, ctx) => ({
  data: await previewRecipients(ctx, query.schoolId, body),
}));
