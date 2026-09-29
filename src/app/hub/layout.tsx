import type { ReactNode } from "react";
import { HubShell } from "@/components/hub/hub";
import { SplashScreen } from "@/components/hub/splash-screen";
import { splashBootScript } from "@/lib/frontend/splash-rules";

const SPLASH_BOOT = splashBootScript();
const BRAND_IMAGES = ["/brand/splash-body.webp", "/brand/splash-tassel.webp", "/brand/splash-shape.webp", "/brand/mark.webp"];

/**
 * Kerangka hub bertahan antarhalaman (sesi & tema tidak dimuat ulang saat pindah bagian). Skrip boot
 * splash berjalan SEBELUM isi hub diurai/dilukis: memutuskan splash (belum login, atau terakhir dipakai
 * > 5 menit lalu) tanpa sempat memperlihatkan halaman lebih dulu (src/lib/frontend/splash-rules.ts).
 */
export default function HubLayout({ children }: { children: ReactNode }) {
  return <>
    {/* Gambar logo (±55 KB) dimuat seawal mungkin agar sudah ada saat intro splash mulai (React memindahkannya ke <head>). */}
    {BRAND_IMAGES.map(href => <link key={href} rel="preload" as="image" type="image/webp" href={href} fetchPriority="high" />)}
    <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
    <SplashScreen />
    <HubShell>{children}</HubShell>
  </>;
}
