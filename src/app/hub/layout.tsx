import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { BrandingProvider } from "@/components/hub/branding";
import { HubShell } from "@/components/hub/hub";
import { SplashScreen } from "@/components/hub/splash-screen";
import { appIcons, iconUrlFor, splashGeometry } from "@/lib/app-settings/icon-rules";
import { appTitle, logoUrlFor } from "@/lib/app-settings/rules";
import { getBrandingOrDefault } from "@/lib/app-settings/service";
import { appEnvOfHost, demoAllowed } from "@/lib/frontend/app-env";
import { earlyDemoScript } from "@/lib/frontend/early-demo";
import { readSessionHint } from "@/lib/frontend/session-hint";
import { splashBootScript } from "@/lib/frontend/splash-rules";

const SPLASH_BOOT = splashBootScript();
const EARLY_DEMO_CAPTURE = earlyDemoScript();
const LOGO_IMAGE = "/brand/mark.webp";
const SPLASH_IMAGES = ["/brand/splash-body.webp", "/brand/splash-tassel.webp", "/brand/splash-shape.webp"];

/** Judul tab & nama aplikasi mengikuti Pengaturan aplikasi (nama bawaan "Student Hub" ada di app/layout.tsx). */
export async function generateMetadata(): Promise<Metadata> {
  const { appName, logoUpdatedAt } = await getBrandingOrDefault();
  // Logo unggahan juga menjadi favicon & ikon layar utama iOS (tanpa logo = ikon bawaan app/layout.tsx).
  const icons = logoUpdatedAt ? { icons: { icon: [{ url: appIcons(logoUpdatedAt).favicon, type: "image/png", sizes: "96x96" }], apple: [{ url: appIcons(logoUpdatedAt).apple, sizes: "180x180" }] } } : {};
  return { title: { absolute: appTitle(appName), template: `%s - ${appName}` }, applicationName: appName, appleWebApp: { title: appName, capable: true, statusBarStyle: "default" }, ...icons };
}

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
  // Produksi / staging dari header Host (nginx meneruskan $host); host lain (lokal) = tanpa sakelar lingkungan.
  const env = appEnvOfHost((await headers()).get("host"));
  // Splash saat membuka situs hanya untuk yang sudah masuk (penanda sesi): hanya merekalah yang perlu gambar
  // splash (±36 KB) seawal mungkin. Tamu memanaskannya setelah halaman dimuat (splash.ts) untuk tirai Masuk.
  const guest = !hint.account && !hint.demo;
  // Identitas aplikasi (Pengaturan aplikasi): logo unggahan menggantikan tanda bawaan di preload & splash.
  const brand = await getBrandingOrDefault();
  const branding = { appName: brand.appName, logoUrl: logoUrlFor(brand.logoUpdatedAt) };
  const logo = branding.logoUrl ?? LOGO_IMAGE;
  const splash = brand.logoUpdatedAt ? { imageUrl: iconUrlFor("splash", brand.logoUpdatedAt), geometry: splashGeometry(brand.logoGeometry) } : null;
  const images = guest ? [logo] : splash ? [splash.imageUrl, logo] : [...SPLASH_IMAGES, logo];
  return <>
    {/* React memindahkan preload ke <head>. */}
    {images.map(href => <link key={href} rel="preload" as="image" type="image/webp" href={href} fetchPriority="high" />)}
    <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
    {/* Tamu: tombol demo di halaman masuk (HTML server) bisa diketuk sebelum JS aktif — dicatat lalu dijalankan. Produksi tanpa demo. */}
    {guest && demoAllowed(env) && <script dangerouslySetInnerHTML={{ __html: EARLY_DEMO_CAPTURE }} />}
    <SplashScreen appName={branding.appName} logo={splash} />
    <BrandingProvider initial={branding}><HubShell hint={hint} env={env}>{children}</HubShell></BrandingProvider>
  </>;
}
