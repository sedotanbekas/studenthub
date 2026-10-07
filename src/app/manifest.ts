import type { MetadataRoute } from "next";
import { appTitle } from "@/lib/app-settings/rules";
import { getBrandingOrDefault } from "@/lib/app-settings/service";
import { DEFAULT_THEME } from "@/lib/schools/theme-rules";

/**
 * Manifest PWA (N3): studenthub.id bisa dipasang di layar utama — di iPhone syarat menerima notifikasi. Tanpa
 * `orientation` (dasbor admin di tablet bebas berputar). Logo berganti -> GANTI NAMA berkas ikon (Chrome hanya
 * memperbarui ikon terpasang bila URL-nya berubah; scripts/brand-assets.mjs). Nama mengikuti Pengaturan aplikasi
 * (dibaca per permintaan); ikon tetap bawaan karena butuh beberapa ukuran PNG & versi maskable.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { appName } = await getBrandingOrDefault();
  return {
    id: "/hub",
    name: appTitle(appName),
    short_name: appName,
    description: "Absensi, rapor, tagihan, dan pengumuman sekolah dalam satu tempat.",
    start_url: "/hub",
    scope: "/",
    display: "standalone",
    lang: "id",
    theme_color: DEFAULT_THEME.bannerColor,
    background_color: "#ffffff",
    icons: [
      { src: "/brand/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
