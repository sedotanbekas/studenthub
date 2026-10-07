import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { createAccessRoleContract, listAccessRolesContract } from "@/lib/roles/contracts";
import { listAccessRoles } from "@/lib/roles/queries";
import { createAccessRole } from "@/lib/roles/service";

export const runtime = "nodejs";

export const GET = defineRoute(listAccessRolesContract, async ({ query }, ctx) => ({ data: await listAccessRoles(requirePrincipal(ctx), query) }));

export const POST = defineRoute(createAccessRoleContract, async ({ body }, ctx) => ({ data: await createAccessRole(body, ctx) }));
