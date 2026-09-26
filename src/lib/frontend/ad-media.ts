/**
 * Sumber gambar untuk berkas iklan/sponsor di browser. Berkas privat (banner sebelum disetujui,
 * bukti transfer) lewat proxy sesi `/api/web/files/{id}`; banner yang sudah tayang memakai salinan
 * publik `imageUrl`. Mode demo memakai id `demo:<path>` yang menunjuk aset statis di `/demo/`.
 */
export const DEMO_FILE_PREFIX = "demo:";

export function fileSrc(fileId: string): string {
  if (fileId.startsWith(DEMO_FILE_PREFIX)) return `/demo/${fileId.slice(DEMO_FILE_PREFIX.length)}`;
  return `/api/web/files/${encodeURIComponent(fileId)}`;
}

/**
 * URL media publik (`https://<domain>/media/...`) dibaca dari domain yang SEDANG dibuka: domain di
 * PUBLIC_MEDIA_BASE_URL bisa berbeda/belum aktif (mis. situs demo di domain lain), sedangkan setiap
 * domain aplikasi melayani /media/ (nginx atau route cadangan Next).
 */
export function sameOriginMedia(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith("/media/") ? `${parsed.pathname}${parsed.search}` : url;
  } catch {
    return url;
  }
}

/** Banner iklan: salinan publik bila ada (iklan disetujui/dijeda), selain itu pratinjau privat. */
export function bannerSrc(ad: { readonly imageUrl: string | null; readonly imageFileId: string }): string {
  return ad.imageUrl ? sameOriginMedia(ad.imageUrl) : fileSrc(ad.imageFileId);
}

/** Host tautan tujuan untuk ditampilkan ("cahayailmu.id"); string asli bila bukan URL valid. */
export function linkHost(targetUrl: string): string {
  try {
    return new URL(targetUrl).host.replace(/^www\./, "");
  } catch {
    return targetUrl;
  }
}
