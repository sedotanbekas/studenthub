"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="standalone"><h1>Ada yang perlu dicoba lagi.</h1><p>Halaman belum berhasil dimuat. Data yang sudah tersimpan tetap aman.</p><button className="button primary" onClick={reset}>Coba lagi</button></main>; }
