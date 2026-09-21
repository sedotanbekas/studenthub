import { defineRoute } from "@/lib/http/route";
import { studentProfileContract } from "@/lib/students/contracts";
import { getOwnProfile } from "@/lib/students/queries";

export const runtime = "nodejs";
export const GET = defineRoute(studentProfileContract, async (_input, ctx) => ({ data: await getOwnProfile(ctx) }));
