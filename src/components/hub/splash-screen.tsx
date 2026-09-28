import type { CSSProperties } from "react";
import { BOOK_LEFT_PAGE, BOOK_RIGHT_PAGE } from "@/lib/frontend/splash-rules";

const SPARK = "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z";
const WORD = "studenthub";
const TLD = ".id";

/**
 * Markup statis splash screen (dirender server, tersembunyi sampai <html data-splash> dipasang oleh
 * skrip boot atau src/components/hub/splash.ts). Logo = siluet buku terbuka yang juga menjadi bentuk
 * masker saat halaman disingkap (src/styles/splash.css). Dekoratif: disembunyikan dari pembaca layar.
 */
export function SplashScreen() {
  const letters = [...WORD, ...TLD];
  return <div className="splash" popover="manual" aria-hidden="true">
    <div className="splash-curtain" />
    <div className="splash-art">
      <span className="splash-ring" />
      <svg className="splash-book" viewBox="0 0 24 24" focusable="false">
        <path className="splash-page splash-page-left" d={BOOK_LEFT_PAGE} />
        <path className="splash-page splash-page-right" d={BOOK_RIGHT_PAGE} />
        <path className="splash-spine" d="M12 6.5v13" />
      </svg>
      {[1, 2, 3].map(n => <svg key={n} className={`splash-spark splash-spark-${n}`} viewBox="0 0 24 24" focusable="false"><path d={SPARK} /></svg>)}
    </div>
    <p className="splash-word">{letters.map((letter, i) => <span key={i} className={i >= WORD.length ? "splash-tld" : undefined} style={{ "--i": i } as CSSProperties}>{letter}</span>)}</p>
  </div>;
}
