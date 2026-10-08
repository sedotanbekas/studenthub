import { renderSVG } from "uqr";

/**
 * Kode QR halaman /pasang, dibuat di server (pustaka tidak ikut dikirim ke browser). Hanya URL http(s) dari
 * APP_ORIGIN yang disandikan — SVG-nya disisipkan apa adanya ke halaman. Latar putih: tetap terbaca di mode gelap.
 */
export function installQrSvg(url: string): string {
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error("Kode QR hanya untuk URL http(s).");
  return renderSVG(url, { ecc: "M", border: 2 });
}
