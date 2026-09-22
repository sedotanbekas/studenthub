import { totpSetupContract } from "@/lib/auth/contracts";
import { setupTotp } from "@/lib/auth/totp-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(totpSetupContract, async (_input, ctx) => ({ data: await setupTotp(ctx) }));
