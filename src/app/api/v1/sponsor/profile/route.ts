import { defineRoute } from "@/lib/http/route";
import { updateOwnProfile } from "@/lib/sponsors/account-service";
import { getOwnSponsorProfileContract, updateOwnSponsorProfileContract } from "@/lib/sponsors/contracts-self";
import { getOwnSponsor, ownSponsorId } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnSponsorProfileContract, async (_input, ctx) => ({ data: await getOwnSponsor(ctx) }));
export const PATCH = defineRoute(updateOwnSponsorProfileContract, async ({ body }, ctx) => ({ data: await updateOwnProfile(ownSponsorId(ctx), body, ctx) }));
