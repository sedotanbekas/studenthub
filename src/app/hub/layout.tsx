import type { ReactNode } from "react";
import { HubShell } from "@/components/hub/hub";
import { SplashScreen } from "@/components/hub/splash-screen";
import { splashBootScript } from "@/lib/frontend/splash-rules";

const SPLASH_BOOT = splashBootScript();

/**
 * Kerangka hub bertahan antarhalaman (sesi & tema tidak dimuat ulang saat pindah bagian). Skrip boot
 * splash berjalan SEBELUM isi hub diurai/dilukis: memutuskan splash (belum login, atau terakhir dipakai
 * > 5 menit lalu) tanpa sempat memperlihatkan halaman lebih dulu (src/lib/frontend/splash-rules.ts).
 */
export default function HubLayout({ children }: { children: ReactNode }) {
  return <>
    <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
    <SplashScreen />
    <HubShell>{children}</HubShell>
  </>;
}
