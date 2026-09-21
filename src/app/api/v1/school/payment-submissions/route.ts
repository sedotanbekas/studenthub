import { listSubmissionsContract } from "@/lib/billing/contracts-review";
import { listSubmissions } from "@/lib/billing/submission-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listSubmissionsContract, async ({ query }, ctx) => listSubmissions(ctx, query));
