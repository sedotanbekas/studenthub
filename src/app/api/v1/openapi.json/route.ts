import { getEnv } from "@/lib/env";
import { guardDocs } from "@/lib/http/basic-auth";
import { buildOpenApiDocument } from "@/lib/openapi/document";
import { ALL_CONTRACTS } from "@/lib/openapi/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: string | null = null;

export async function GET(req: Request): Promise<Response> {
  const env = getEnv();
  const denied = guardDocs(req, env.DOCS_BASIC_AUTH);
  if (denied) return denied;
  cached ??= JSON.stringify(buildOpenApiDocument(ALL_CONTRACTS, { version: env.APP_VERSION, serverUrl: env.APP_ORIGIN }));
  return new Response(cached, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
