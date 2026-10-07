import type { MetadataRoute } from "next";
import { appIcons } from "@/lib/app-settings/icon-rules";
import { appTitle } from "@/lib/app-settings/rules";
import { getBrandingOrDefault } from "@/lib/app-settings/service";
import { DEFAULT_THEME } from "@/lib/schools/theme-rules";

/**
 * Manifest PWA (N3): studenthub.id bisa dipasang di layar utama — di iPhone syarat menerima notifikasi. Tanpa
 * `orientation` (dasbor admin di tablet bebas berputar). Logo berganti -> GANTI NAMA berkas ikon (Chrome hanya
 * memperbarui ikon terpasang bila URL-nya berubah; scripts/brand-assets.mjs). Nama
 * & ikon mengikuti Pengaturan aplikasi (dibaca per permintaan; URL ikon berversi = Chrome memperbarui ikon terpasang).
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { appName, logoUpdatedAt } = await getBrandingOrDefault();
  const icons = appIcons(logoUpdatedAt);
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
      { src: icons.app192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icons.app512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icons.maskable512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
