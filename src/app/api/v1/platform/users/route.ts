import { pageMeta } from "@/lib/http/envelope";
import { defineRoute } from "@/lib/http/route";
import { createPlatformUserContract, listPlatformUsersContract } from "@/lib/users/contracts";
import { listUsers } from "@/lib/users/queries";
import { createUser } from "@/lib/users/service";

export const runtime = "nodejs";

export const GET = defineRoute(listPlatformUsersContract, async ({ query }) => {
  const { items, total } = await listUsers(query);
  return { data: items, meta: pageMeta(total, query.page, query.limit) };
});

export const POST = defineRoute(createPlatformUserContract, async ({ body }, ctx) => ({ data: await createUser(body, ctx) }));
