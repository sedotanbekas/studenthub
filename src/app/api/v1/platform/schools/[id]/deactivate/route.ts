import { defineRoute } from "@/lib/http/route";
import { deactivatePlatformSchoolContract } from "@/lib/schools/contracts";
import { deactivateSchool } from "@/lib/schools/service";

export const runtime = "nodejs";

export const POST = defineRoute(deactivatePlatformSchoolContract, async ({ params, body }, ctx) => ({
  data: await deactivateSchool(params.id, body.reason, ctx),
}));
