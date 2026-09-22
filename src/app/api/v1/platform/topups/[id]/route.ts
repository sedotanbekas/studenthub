import { defineRoute } from "@/lib/http/route";
import { getPlatformTopUpContract } from "@/lib/sponsors/contracts-platform";
import { getTopUpForReview } from "@/lib/sponsors/topup-queries";

export const runtime = "nodejs";
export const GET = defineRoute(getPlatformTopUpContract, async ({ params }) => ({ data: await getTopUpForReview(params.id) }));
