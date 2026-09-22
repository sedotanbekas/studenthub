import { defineRoute } from "@/lib/http/route";
import { updateSponsor } from "@/lib/sponsors/account-service";
import { getSponsorContract, updateSponsorContract } from "@/lib/sponsors/contracts-platform";
import { getSponsorDetail } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getSponsorContract, async ({ params }) => ({ data: await getSponsorDetail(params.id) }));
export const PATCH = defineRoute(updateSponsorContract, async ({ params, body }, ctx) => ({ data: await updateSponsor(params.id, body, ctx) }));
