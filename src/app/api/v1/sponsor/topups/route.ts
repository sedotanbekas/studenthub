import { defineRoute } from "@/lib/http/route";
import { listOwnTopUpsContract, submitTopUpContract } from "@/lib/sponsors/contracts-self";
import { ownSponsorId } from "@/lib/sponsors/queries";
import { listOwnTopUps } from "@/lib/sponsors/topup-queries";
import { submitTopUp } from "@/lib/sponsors/topup-service";

export const runtime = "nodejs";
export const GET = defineRoute(listOwnTopUpsContract, async ({ query }, ctx) => listOwnTopUps(ownSponsorId(ctx), query));
export const POST = defineRoute(submitTopUpContract, async ({ body }, ctx) => ({ data: await submitTopUp(ctx, body), status: 201 }));
