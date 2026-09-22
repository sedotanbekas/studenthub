import { defineRoute } from "@/lib/http/route";
import { getOwnBalanceContract } from "@/lib/sponsors/contracts-self";
import { getSponsorBalance, ownSponsorId } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnBalanceContract, async (_input, ctx) => ({ data: await getSponsorBalance(ownSponsorId(ctx)) }));
