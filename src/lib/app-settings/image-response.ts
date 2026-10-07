/** Respons gambar publik (logo & ikon aplikasi): cache 1 hari (URL berversi ?v= berganti), tanpa eksekusi konten. */
export function publicImageResponse(file: { readonly data: Uint8Array; readonly mimeType: string }): Response {
  return new Response(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.byteLength),
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
