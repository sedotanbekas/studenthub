import { changePasswordContract } from "@/lib/auth/contracts";
import { changePassword } from "@/lib/auth/password-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(changePasswordContract, async ({ body }, ctx) => ({ data: await changePassword(body, ctx) }));
