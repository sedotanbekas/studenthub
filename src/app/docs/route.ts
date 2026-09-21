import { ApiReference } from "@scalar/nextjs-api-reference";
import { getEnv } from "@/lib/env";
import { guardDocs } from "@/lib/http/basic-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Versi bundel Scalar dipin (bukan "latest") agar skrip CDN tidak berubah diam-diam. */
const SCALAR_CDN = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.69.2";

const reference = ApiReference({
  url: "/api/v1/openapi.json",
  pageTitle: "Student Hub API",
  cdn: SCALAR_CDN,
  hideClientButton: false,
});

export async function GET(req: Request): Promise<Response> {
  const denied = guardDocs(req, getEnv().DOCS_BASIC_AUTH);
  if (denied) return denied;
  return reference();
}
