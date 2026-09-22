import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: { default: "Student Hub — Ruang untuk tumbuh", template: "%s · Student Hub" }, description: "Satu ruang untuk siswa, sekolah, dan setiap langkah kemajuan." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="id"><body>{children}</body></html>;
}
