import { defineRoute } from "@/lib/http/route";
import { listOwnLedgerContract } from "@/lib/sponsors/contracts-self";
import { listLedger, ownSponsorId } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnLedgerContract, async ({ query }, ctx) => listLedger(ownSponsorId(ctx), query));
