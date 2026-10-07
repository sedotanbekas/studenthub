import { defineRoute } from "@/lib/http/route";
import { assignPlatformUserAccessRoleContract } from "@/lib/roles/contracts";
import { assignAccessRole } from "@/lib/roles/service";

export const runtime = "nodejs";

export const PUT = defineRoute(assignPlatformUserAccessRoleContract, async ({ params, body }, ctx) => ({
  data: await assignAccessRole({ userId: params.id, schoolId: null }, body.accessRoleId, ctx),
}));
