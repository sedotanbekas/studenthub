import { submitProofContract } from "@/lib/billing/contracts-student";
import { submitPaymentProof } from "@/lib/billing/submission-service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
export const POST = defineRoute(submitProofContract, async ({ params, body }, ctx) => ({
  data: await submitPaymentProof(ctx, params.id, body),
  status: 201,
}));
