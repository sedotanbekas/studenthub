import type { NextRequest } from "next/server";

/** Nginx menetapkan Host dan X-Forwarded-Proto; origin harus sama persis untuk mutasi cookie. */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return (protocol === "https" || protocol === "http") && origin === `${protocol}://${host}`;
}
/** Buffer dibatasi sebelum meneruskan upload; stream tanpa Content-Length juga dihitung. */
export async function boundedBody(request: Request, limit = 10_485_760): Promise<ArrayBuffer | undefined> {
  if (!request.body) return undefined;
  if (Number(request.headers.get("content-length")) > limit) throw new RangeError("Berkas terlalu besar. Maksimal 10 MB.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RangeError("Berkas terlalu besar. Maksimal 10 MB."); }
    chunks.push(chunk.value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return buffer.buffer;
}
