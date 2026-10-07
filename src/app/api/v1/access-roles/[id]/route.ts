import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { deleteAccessRoleContract, getAccessRoleContract, updateAccessRoleContract } from "@/lib/roles/contracts";
import { getAccessRole } from "@/lib/roles/queries";
import { deleteAccessRole, updateAccessRole } from "@/lib/roles/service";

export const runtime = "nodejs";

export const GET = defineRoute(getAccessRoleContract, async ({ params }, ctx) => ({ data: await getAccessRole(requirePrincipal(ctx), params.id) }));

export const PATCH = defineRoute(updateAccessRoleContract, async ({ params, body }, ctx) => ({ data: await updateAccessRole(params.id, body, ctx) }));

export const DELETE = defineRoute(deleteAccessRoleContract, async ({ params }, ctx) => ({ data: await deleteAccessRole(params.id, ctx) }));
