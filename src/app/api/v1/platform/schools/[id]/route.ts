import { defineRoute } from "@/lib/http/route";
import { getPlatformSchoolContract, updatePlatformSchoolContract } from "@/lib/schools/contracts";
import { getPlatformSchoolDetail } from "@/lib/schools/queries";
import { updateSchool } from "@/lib/schools/service";

export const runtime = "nodejs";

export const GET = defineRoute(getPlatformSchoolContract, async ({ params }) => ({ data: await getPlatformSchoolDetail(params.id) }));

export const PATCH = defineRoute(updatePlatformSchoolContract, async ({ params, body }, ctx) => ({
  data: await updateSchool(params.id, body, ctx),
}));
