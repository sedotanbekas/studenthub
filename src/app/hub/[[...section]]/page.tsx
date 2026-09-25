import { HubSection } from "@/components/hub/hub-section";
/** `.hub-page` = elemen yang digeser saat pindah halaman (src/components/hub/page-slide.ts). */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const section = (await params).section?.[0] ?? "dashboard";
  return <div className="hub-page" data-section={section}><HubSection section={section} /></div>;
}
