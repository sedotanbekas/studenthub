import { defineRoute } from "@/lib/http/route";
import { listPlatformTopUpsContract } from "@/lib/sponsors/contracts-platform";
import { listPlatformTopUps } from "@/lib/sponsors/topup-queries";

export const runtime = "nodejs";
export const GET = defineRoute(listPlatformTopUpsContract, async ({ query }) => listPlatformTopUps(query));
