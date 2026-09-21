import { defineRoute } from "@/lib/http/route";
import { resetPlatformUserPasswordContract } from "@/lib/users/contracts";
import { resetUserPassword } from "@/lib/users/service";

export const runtime = "nodejs";

export const POST = defineRoute(resetPlatformUserPasswordContract, async ({ params, body }, ctx) => ({
  data: await resetUserPassword(params.id, body.newPassword, ctx),
}));
