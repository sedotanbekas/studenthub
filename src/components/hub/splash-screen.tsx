import type { CSSProperties } from "react";
import type { MaskGeometry } from "@/lib/app-settings/icon-rules";
import { DEFAULT_APP_NAME, splitBrandName } from "@/lib/app-settings/rules";

const NBSP = String.fromCharCode(0xa0);
const SPARK = "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z";

/**
 * Markup statis splash screen (dirender server, tersembunyi sampai <html data-splash> dipasang oleh
 * skrip boot atau src/components/hub/splash.ts). Logo = tanda "S + toga" bergaya stiker
 * (public/brand/splash-body.webp) dengan rumbai toga sebagai lapisan terpisah yang berayun; siluet
 * gabungannya (splash-shape.webp) menjadi bentuk masker saat halaman disingkap (src/styles/splash.css).
 * Logo unggahan super admin (Pengaturan aplikasi): kanvas splash-nya (/api/v1/app/icon/splash) menggantikan tanda,
 * rumbai, DAN bentuk lubang masker; pusat zoom & jari-jari dalam dari siluet logo itu. Tulisan = nama aplikasi.
 * Dekoratif: disembunyikan dari pembaca layar.
 */
export interface SplashLogo { readonly imageUrl: string; readonly geometry: MaskGeometry }

export function SplashScreen({ appName = DEFAULT_APP_NAME, logo = null }: { appName?: string; logo?: SplashLogo | null }) {
  const { head, tail } = splitBrandName(appName);
  // Spasi sebagai NBSP: huruf adalah inline-block, spasi biasa akan lenyap.
  const letters = [...head, ...tail].map(letter => (letter === " " ? NBSP : letter));
  const image = logo ? `url("${logo.imageUrl}")` : null;
  const vars = logo && image ? { "--splash-ox": logo.geometry.ox, "--splash-oy": logo.geometry.oy, "--splash-mask": image } as CSSProperties : undefined;
  return <div className="splash" popover="manual" aria-hidden="true" style={vars} data-inscribed={logo?.geometry.inscribed} data-image={logo?.imageUrl}>
    <div className="splash-curtain" />
    <div className="splash-art">
      <span className="splash-ring" />
      <span className="splash-mark"><span className="splash-logo" style={image ? { backgroundImage: image } : undefined} />{!logo && <span className="splash-tassel" />}</span>
      {[1, 2, 3].map(n => <svg key={n} className={`splash-spark splash-spark-${n}`} viewBox="0 0 24 24" focusable="false"><path d={SPARK} /></svg>)}
    </div>
    <p className="splash-word">{letters.map((letter, i) => <span key={i} className={i >= head.length ? "splash-hub" : undefined} style={{ "--i": i } as CSSProperties}>{letter}</span>)}</p>
  </div>;
}
