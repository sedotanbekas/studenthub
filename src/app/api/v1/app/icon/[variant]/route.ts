import { getIconContract } from "@/lib/app-settings/contracts";
import { readIcon } from "@/lib/app-settings/icon-service";
import { publicImageResponse } from "@/lib/app-settings/image-response";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const GET = defineRoute(getIconContract, async ({ params }) => publicImageResponse(await readIcon(params.variant)));
