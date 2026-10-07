import { getLogoContract } from "@/lib/app-settings/contracts";
import { readLogo } from "@/lib/app-settings/service";
import { defineRoute } from "@/lib/http/route";

export const runtime = "nodejs";
/** Logo publik: cache 1 hari (URL berversi ?v= berganti saat logo diganti), tanpa eksekusi konten. */
export const GET = defineRoute(getLogoContract, async () => {
  const logo = await readLogo();
  return new Response(new Uint8Array(logo.data), {
    status: 200,
    headers: {
      "Content-Type": logo.mimeType,
      "Content-Length": String(logo.data.byteLength),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});
