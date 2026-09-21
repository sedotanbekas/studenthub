import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { createPlatformSchoolContract, listPlatformSchoolsContract } from "@/lib/schools/contracts";
import { listSchools } from "@/lib/schools/queries";
import { createSchool } from "@/lib/schools/service";

export const runtime = "nodejs";

export const GET = defineRoute(listPlatformSchoolsContract, async ({ query }) => {
  const { items, total } = await listSchools(query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});

export const POST = defineRoute(createPlatformSchoolContract, async ({ body }, ctx) => ({ data: await createSchool(body, ctx) }));
