import type { Metadata } from "next";
import "../../styles/install-page.css";
import { InstallPage } from "@/components/hub/install-page";
import { appIcons, appIdentityMetadata } from "@/lib/app-settings/icon-rules";
import { getBrandingOrDefault } from "@/lib/app-settings/service";
import { getEnv } from "@/lib/env";
import { installPageUrl } from "@/lib/frontend/install-rules";
import { installQrSvg } from "@/lib/install/qr";

/** Nama & logo mengikuti Pengaturan aplikasi (dibaca per permintaan, seperti manifest). */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { appName, logoUpdatedAt } = await getBrandingOrDefault();
  return {
    title: { absolute: `Pasang ${appName}` },
    description: `Pasang ${appName} di HP Android atau iPhone — tanpa Play Store atau App Store.`,
    ...appIdentityMetadata(appName, logoUpdatedAt),
  };
}

/** Halaman publik pemasangan PWA (keputusan pemilik 2026-10-08): dibagikan sekolah lewat QR/WhatsApp, tanpa login. */
export default async function InstallRoute() {
  const { appName, logoUpdatedAt } = await getBrandingOrDefault();
  const pageUrl = installPageUrl(getEnv().APP_ORIGIN);
  return <InstallPage appName={appName} iconUrl={appIcons(logoUpdatedAt).app192} qrSvg={installQrSvg(pageUrl)} pageUrl={pageUrl} />;
}
