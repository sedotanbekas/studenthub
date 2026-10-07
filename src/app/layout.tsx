import type { Metadata, Viewport } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "../styles/shell.css";
import "../styles/content.css";
import "../styles/student.css";
import "../styles/charts.css";
import "../styles/ads.css";
import "../styles/sponsor.css";
import "../styles/spp.css";
import "../styles/monitor.css";
import "../styles/campaigns.css";
import "../styles/review.css";
import "../styles/accounts.css";
import "../styles/school-charts.css";
import "../styles/academics.css";
import "../styles/wizards.css";
import "../styles/glass.css";
import "../styles/login-art.css";
import "../styles/roles.css";
import "../styles/transitions.css";
import "../styles/print.css";
import "../styles/splash.css";
import "../styles/student-rounded.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
/** Font bulat tebal untuk tulisan logo "StudentHub" (logo & splash). */
const brand = Fredoka({ subsets: ["latin"], weight: "700", variable: "--font-brand", display: "swap" });
export const metadata: Metadata = {
  // Judul tab: nama merek + apa isinya (permintaan pemilik 2026-10-07; dulu "studenthub.id").
  title: { default: "Student Hub - Absensi, Rapor & Tagihan Sekolah", template: "%s - Student Hub" },
  applicationName: "Student Hub",
  // Dibuka dari ikon layar utama iPhone = aplikasi mandiri (syarat Web Push iOS 16.4+, N3).
  appleWebApp: { title: "Student Hub", capable: true, statusBarStyle: "default" },
  description: "Absensi, rapor, tagihan, dan pengumuman sekolah dalam satu tempat.",
  // Ikon bawaan lewat metadata (bukan berkas app/icon.png yang selalu menang): /hub menggantinya dengan logo unggahan.
  icons: { icon: [{ url: "/brand/icon-96.png", type: "image/png", sizes: "96x96" }], apple: [{ url: "/brand/apple-icon-180.png", sizes: "180x180" }] },
};
/** theme-color dikelola saat runtime oleh applyTheme (warna banner tema sekolah), bukan di sini. */
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Skrip boot splash (app/hub/layout.tsx) memasang data-splash & warna splash di <html> sebelum hidrasi.
  return <html lang="id" className={`${sans.variable} ${brand.variable}`} suppressHydrationWarning><body>{children}</body></html>;
}
