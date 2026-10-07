import { getLogoContract } from "@/lib/app-settings/contracts";
import { publicImageResponse } from "@/lib/app-settings/image-response";
import { readLogo } from "@/lib/app-settings/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getLogoContract, async () => publicImageResponse(await readLogo()));
