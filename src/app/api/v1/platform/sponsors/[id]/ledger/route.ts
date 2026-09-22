import { defineRoute } from "@/lib/http/route";
import { platformLedgerContract } from "@/lib/sponsors/contracts-platform";
import { listPlatformLedger } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const GET = defineRoute(platformLedgerContract, async ({ params, query }) => listPlatformLedger(params.id, query));
