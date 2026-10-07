import { getBrandingContract } from "@/lib/app-settings/contracts";
import { getBrandingDto } from "@/lib/app-settings/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getBrandingContract, async () => ({ data: await getBrandingDto() }));
