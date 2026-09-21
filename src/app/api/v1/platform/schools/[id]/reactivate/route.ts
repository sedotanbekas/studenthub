import { defineRoute } from "@/lib/http/route";
import { reactivatePlatformSchoolContract } from "@/lib/schools/contracts";
import { reactivateSchool } from "@/lib/schools/service";

export const runtime = "nodejs";

export const POST = defineRoute(reactivatePlatformSchoolContract, async ({ params }, ctx) => ({
  data: await reactivateSchool(params.id, ctx),
}));
