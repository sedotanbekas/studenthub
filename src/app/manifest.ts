import type { MetadataRoute } from "next";
import { DEFAULT_THEME } from "@/lib/schools/theme-rules";

/**
 * Manifest PWA (N3): studenthub.id bisa dipasang di layar utama — di iPhone syarat menerima notifikasi. Tanpa
 * `orientation` (dasbor admin di tablet bebas berputar). Logo berganti -> GANTI NAMA berkas ikon (Chrome hanya
 * memperbarui ikon terpasang bila URL-nya berubah; scripts/brand-assets.mjs).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/hub",
    name: "Student Hub - Absensi, Rapor & Tagihan Sekolah",
    short_name: "Student Hub",
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
