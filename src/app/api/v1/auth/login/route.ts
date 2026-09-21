import { loginContract } from "@/lib/auth/contracts";
import { login } from "@/lib/auth/login-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(loginContract, async ({ body }, ctx) => ({ data: await login(body, ctx) }));
