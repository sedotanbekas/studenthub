import { defineRoute } from "@/lib/http/route";
import { listProvincesContract } from "@/lib/platform/contracts";
import { listProvinces } from "@/lib/platform/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listProvincesContract, async () => ({ data: await listProvinces() }));
