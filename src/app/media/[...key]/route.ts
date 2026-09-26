import { isAppError } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { getStorage } from "@/lib/storage/driver";
import { PUBLIC_MEDIA_HEADERS, publicMediaKey } from "@/lib/storage/public-media";

export const runtime = "nodejs";

const notFound = () => new Response("Tidak ditemukan", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });

/**
 * Cadangan `/media/*` bila nginx belum meng-alias folder publik (dev, atau vhost baru): hanya salinan
 * publik banner iklan yang sudah disetujui. Bukan endpoint API (tanpa defineRoute/sesi) — setara berkas statis.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const media = publicMediaKey((await params).key);
  if (!media) return notFound();
  try {
    const { body, size } = await getStorage().stream(media.key);
    return new Response(body, { headers: { ...PUBLIC_MEDIA_HEADERS, "Content-Type": media.contentType, "Content-Length": String(size) } });
  } catch (error: unknown) {
    if (isAppError(error) && error.status === 404) return notFound();
    log.error("media publik gagal dibaca", safeErrorFields(error));
    return new Response("Berkas belum dapat dimuat", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
