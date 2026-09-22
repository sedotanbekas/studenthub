import { listTargetSchoolsContract } from "@/lib/ads/contracts-sponsor";
import { listTargetSchools } from "@/lib/ads/targeting-queries";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(listTargetSchoolsContract, async ({ query }) => listTargetSchools(query));
