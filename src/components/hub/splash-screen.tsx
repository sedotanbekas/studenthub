import type { CSSProperties } from "react";

const SPARK = "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z";
const WORD = "Student";
const HUB = "Hub";

/**
 * Markup statis splash screen (dirender server, tersembunyi sampai <html data-splash> dipasang oleh
 * skrip boot atau src/components/hub/splash.ts). Logo = tanda "S + toga" bergaya stiker
 * (public/brand/splash-body.webp) dengan rumbai toga sebagai lapisan terpisah yang berayun; siluet
 * gabungannya (splash-shape.webp) menjadi bentuk masker saat halaman disingkap (src/styles/splash.css).
 * Dekoratif: disembunyikan dari pembaca layar.
 */
export function SplashScreen() {
  const letters = [...WORD, ...HUB];
  return <div className="splash" popover="manual" aria-hidden="true">
    <div className="splash-curtain" />
    <div className="splash-art">
      <span className="splash-ring" />
      <span className="splash-mark"><span className="splash-logo" /><span className="splash-tassel" /></span>
      {[1, 2, 3].map(n => <svg key={n} className={`splash-spark splash-spark-${n}`} viewBox="0 0 24 24" focusable="false"><path d={SPARK} /></svg>)}
    </div>
    <p className="splash-word">{letters.map((letter, i) => <span key={i} className={i >= WORD.length ? "splash-hub" : undefined} style={{ "--i": i } as CSSProperties}>{letter}</span>)}</p>
  </div>;
}
