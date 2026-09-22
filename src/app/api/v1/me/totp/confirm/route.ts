import { totpConfirmContract } from "@/lib/auth/contracts";
import { confirmTotp } from "@/lib/auth/totp-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(totpConfirmContract, async ({ body }, ctx) => ({ data: await confirmTotp(body.code, ctx) }));
