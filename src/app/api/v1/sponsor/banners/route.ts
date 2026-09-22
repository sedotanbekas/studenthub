import { uploadBanner } from "@/lib/ads/banner-service";
import { uploadBannerContract } from "@/lib/ads/contracts-sponsor";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(uploadBannerContract, async ({ body }, ctx) => ({ data: await uploadBanner(ctx, body), status: 201 }));
