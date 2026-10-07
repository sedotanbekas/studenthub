"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { appTitle, DEFAULT_APP_NAME, splitBrandName } from "@/lib/app-settings/rules";

/**
 * Identitas aplikasi (nama & logo dari menu Pengaturan aplikasi). Nilai awal dibaca server di app/hub/layout.tsx
 * sehingga logo & nama benar sejak HTML pertama (tanpa kedip); halaman Pengaturan aplikasi memperbaruinya
 * langsung setelah disimpan (sidebar, topbar, dan judul tab ikut berganti tanpa muat ulang).
 */
export interface Branding {
  readonly appName: string;
  readonly logoUrl: string | null;
}

export const DEFAULT_BRANDING: Branding = { appName: DEFAULT_APP_NAME, logoUrl: null };

interface BrandingContextValue { readonly branding: Branding; readonly setBranding: (next: Branding) => void }

const BrandingContext = createContext<BrandingContextValue>({ branding: DEFAULT_BRANDING, setBranding: () => {} });

export function BrandingProvider({ initial, children }: { initial: Branding; children: ReactNode }) {
  const [branding, setState] = useState(initial);
  const setBranding = useCallback((next: Branding) => {
    setState(next);
    document.title = appTitle(next.appName);
  }, []);
  const value = useMemo(() => ({ branding, setBranding }), [branding, setBranding]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export const useBranding = (): BrandingContextValue => useContext(BrandingContext);

/** Logo + logo kata (kata terakhir berwarna aksen). Logo unggahan menggantikan tanda "S + toga" bawaan. */
export function Brand() {
  return <BrandView {...useBranding().branding} />;
}

export function BrandMark() {
  return <LogoView logoUrl={useBranding().branding.logoUrl} />;
}

/** Tampilan murni (juga pratinjau draf di Pengaturan aplikasi). */
export function BrandView({ appName, logoUrl }: Branding) {
  const { head, tail } = splitBrandName(appName);
  // Nama panjang (> 14 huruf) memakai huruf lebih kecil; sisanya terpotong elipsis (nama utuh di tooltip).
  return <span className={`brand${appName.length > 14 ? " brand-long" : ""}`}><LogoView logoUrl={logoUrl} /><span className="brand-name" title={appName}>{head}{tail && <span className="brand-hub">{tail}</span>}</span></span>;
}

export function LogoView({ logoUrl }: { logoUrl: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element -- logo kecil dari API (bukan aset build), tanpa optimasi Next.
  if (logoUrl) return <img className="brand-logo custom" src={logoUrl} alt="" aria-hidden="true" />;
  return <span className="brand-logo" aria-hidden="true" />;
}
