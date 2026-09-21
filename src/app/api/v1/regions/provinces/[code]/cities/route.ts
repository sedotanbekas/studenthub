import { defineRoute } from "@/lib/http/route";
import { listCitiesContract } from "@/lib/platform/contracts";
import { listCities } from "@/lib/platform/queries";

export const runtime = "nodejs";
export const GET = defineRoute(listCitiesContract, async ({ params }) => ({ data: await listCities(params.code) }));
