import { requirePrincipal } from "@/lib/auth/principal";
import { defineRoute } from "@/lib/http/route";
import { fileResponseHeaders, getFileContract } from "@/lib/platform/files-contracts";
import { openFileForViewer } from "@/lib/storage/files";

export const runtime = "nodejs";
export const GET = defineRoute(getFileContract, async ({ params, query }, ctx) => {
  const file = await openFileForViewer(params.id, requirePrincipal(ctx));
  return new Response(file.body, { status: 200, headers: fileResponseHeaders(file, query.download === "1") });
});
