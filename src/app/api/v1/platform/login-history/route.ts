import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { listLoginHistoryContract } from "@/lib/login-history/contracts";
import { listLoginHistory } from "@/lib/login-history/queries";

export const runtime = "nodejs";

export const GET = defineRoute(listLoginHistoryContract, async ({ query }) => {
  const { items, total } = await listLoginHistory(query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});
