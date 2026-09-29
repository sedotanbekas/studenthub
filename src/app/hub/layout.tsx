import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { HubShell } from "@/components/hub/hub";
import { SplashScreen } from "@/components/hub/splash-screen";
import { earlyDemoScript } from "@/lib/frontend/early-demo";
import { readSessionHint } from "@/lib/frontend/session-hint";
import { splashBootScript } from "@/lib/frontend/splash-rules";

const SPLASH_BOOT = splashBootScript();
const EARLY_DEMO_CAPTURE = earlyDemoScript();
const LOGO_IMAGE = "/brand/mark.webp";
const SPLASH_IMAGES = ["/brand/splash-body.webp", "/brand/splash-tassel.webp", "/brand/splash-shape.webp"];

/**
 * Kerangka hub bertahan antarhalaman (sesi & tema tidak dimuat ulang saat pindah bagian). Skrip boot
 * splash berjalan SEBELUM isi hub diurai/dilukis: memutuskan splash (sudah masuk dan terakhir dipakai
 * > 5 menit lalu; tamu tidak pernah) tanpa sempat memperlihatkan halaman lebih dulu
 * (src/lib/frontend/splash-rules.ts).
 * Penanda sesi (cookie tanpa rahasia) menentukan tampilan awal: pengunjung tanpa sesi langsung menerima
 * halaman masuk di HTML (src/lib/frontend/session-hint.ts).
 */
export default async function HubLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const hint = readSessionHint(name => jar.get(name)?.value);
  // Splash saat membuka situs hanya untuk yang sudah masuk (penanda sesi): hanya merekalah yang perlu gambar
  // splash (±36 KB) seawal mungkin. Tamu memanaskannya setelah halaman dimuat (splash.ts) untuk tirai Masuk.
  const guest = !hint.account && !hint.demo;
  const images = guest ? [LOGO_IMAGE] : [...SPLASH_IMAGES, LOGO_IMAGE];
  return <>
    {/* React memindahkan preload ke <head>. */}
    {images.map(href => <link key={href} rel="preload" as="image" type="image/webp" href={href} fetchPriority="high" />)}
    <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
    {/* Tamu: tombol demo di halaman masuk (HTML server) bisa diketuk sebelum JS aktif — dicatat lalu dijalankan. */}
    {guest && <script dangerouslySetInnerHTML={{ __html: EARLY_DEMO_CAPTURE }} />}
    <SplashScreen />
    <HubShell hint={hint}>{children}</HubShell>
  </>;
}
