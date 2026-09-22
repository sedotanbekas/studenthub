import { defineRoute } from "@/lib/http/route";
import { createSponsorAccount } from "@/lib/sponsors/account-service";
import { createSponsorContract, listSponsorsContract } from "@/lib/sponsors/contracts-platform";
import { listSponsors } from "@/lib/sponsors/queries";

export const runtime = "nodejs";
export const POST = defineRoute(createSponsorContract, async ({ body }, ctx) => ({ data: await createSponsorAccount(body, ctx), status: 201 }));
export const GET = defineRoute(listSponsorsContract, async ({ query }) => listSponsors(query));
