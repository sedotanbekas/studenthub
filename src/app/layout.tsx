import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "../styles/shell.css";
import "../styles/content.css";
import "../styles/student.css";
import "../styles/glass.css";
import "../styles/transitions.css";
import "../styles/print.css";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
export const metadata: Metadata = { title: { default: "Student Hub", template: "%s · Student Hub" }, description: "Absensi, rapor, tagihan, dan pengumuman sekolah dalam satu tempat." };
/** theme-color dikelola saat runtime oleh applyTheme (warna banner tema sekolah), bukan di sini. */
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="id" className={sans.variable}><body>{children}</body></html>;
}
