import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { listPlatformAuditLogs } from "@/lib/users/audit-logs";
import { listPlatformAuditLogsContract } from "@/lib/users/contracts";

export const runtime = "nodejs";

export const GET = defineRoute(listPlatformAuditLogsContract, async ({ query }) => {
  const { items, total } = await listPlatformAuditLogs(query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});
