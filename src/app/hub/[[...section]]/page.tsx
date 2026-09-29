import { SectionOutlet } from "@/components/hub/section-outlet";
/**
 * `.hub-page` = isi satu bagian hub; digeser bersama banner di `.hub-view` (src/components/hub/page-slide.ts).
 * Isinya dari modul yang dimuat terpisah (src/components/hub/sections.ts), bukan bagian bundel halaman masuk.
 */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const section = (await params).section?.[0] ?? "dashboard";
  return <div className="hub-page" data-section={section}><SectionOutlet section={section} /></div>;
}
