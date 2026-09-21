import { requirePrincipal } from "@/lib/auth/principal";
import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { resolveSchoolScope } from "@/lib/tenant/scope";
import { listSchoolAuditLogs } from "@/lib/users/audit-logs";
import { listSchoolAuditLogsContract } from "@/lib/users/contracts";

export const runtime = "nodejs";

export const GET = defineRoute(listSchoolAuditLogsContract, async ({ query }, ctx) => {
  const scope = resolveSchoolScope(requirePrincipal(ctx), query.schoolId);
  const { items, total } = await listSchoolAuditLogs(scope, query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});
