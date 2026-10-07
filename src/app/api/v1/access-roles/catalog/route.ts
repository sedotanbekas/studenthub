import { defineRoute } from "@/lib/http/route";
import { getPermissionCatalogContract } from "@/lib/roles/contracts";
import { permissionCatalog } from "@/lib/roles/queries";

export const runtime = "nodejs";

export const GET = defineRoute(getPermissionCatalogContract, async () => ({ data: permissionCatalog() }));
