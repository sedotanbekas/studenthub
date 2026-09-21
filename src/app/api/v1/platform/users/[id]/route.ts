import { defineRoute } from "@/lib/http/route";
import { getPlatformUserContract, updatePlatformUserContract } from "@/lib/users/contracts";
import { getUserDetail } from "@/lib/users/queries";
import { updateUser } from "@/lib/users/service";

export const runtime = "nodejs";

export const GET = defineRoute(getPlatformUserContract, async ({ params }, ctx) => ({ data: await getUserDetail(params.id, ctx.now) }));

export const PATCH = defineRoute(updatePlatformUserContract, async ({ params, body }, ctx) => ({
  data: await updateUser(params.id, body, ctx),
}));
