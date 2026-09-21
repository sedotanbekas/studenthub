import { defineRoute } from "@/lib/http/route";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import { metaEnumsContract } from "@/lib/platform/contracts";

export const runtime = "nodejs";
export const GET = defineRoute(metaEnumsContract, async () => ({ data: ENUM_LABELS }));
