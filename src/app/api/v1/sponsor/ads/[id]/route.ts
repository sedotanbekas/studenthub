import { findOwnAd } from "@/lib/ads/ad-queries";
import { deleteDraftAd, updateAd } from "@/lib/ads/ad-service";
import { deleteAdContract, getOwnAdContract, updateAdContract } from "@/lib/ads/contracts-sponsor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getOwnAdContract, async ({ params }, ctx) => ({ data: await findOwnAd(ctx, params.id) }));
export const PATCH = defineRoute(updateAdContract, async ({ params, body }, ctx) => ({ data: await updateAd(ctx, params.id, body) }));
export const DELETE = defineRoute(deleteAdContract, async ({ params }, ctx) => ({ data: await deleteDraftAd(ctx, params.id) }));
