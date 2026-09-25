import { HubSection } from "@/components/hub/hub-section";
/** `.hub-page` = isi satu bagian hub; digeser bersama banner di `.hub-view` (src/components/hub/page-slide.ts). */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const section = (await params).section?.[0] ?? "dashboard";
  return <div className="hub-page" data-section={section}><HubSection section={section} /></div>;
}
