import { forgetMyTrustedDevices } from "@/lib/auth/account-settings-service";
import { forgetTrustedDevicesContract } from "@/lib/auth/contracts";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const DELETE = defineRoute(forgetTrustedDevicesContract, async (_input, ctx) => ({ data: await forgetMyTrustedDevices(ctx) }));
