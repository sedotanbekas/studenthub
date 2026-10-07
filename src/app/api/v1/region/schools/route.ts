import { requirePrincipal } from "@/lib/auth/principal";
import { forbidden } from "@/lib/http/errors";
import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { listRegionSchoolsContract } from "@/lib/region/contracts";
import { listRegionSchools } from "@/lib/region/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listRegionSchoolsContract, async ({ query }, ctx) => {
  const { region } = requirePrincipal(ctx);
  if (!region) throw forbidden("FORBIDDEN", "Akun ini tidak terikat wilayah.");
  const { items, total } = await listRegionSchools(region, query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});
