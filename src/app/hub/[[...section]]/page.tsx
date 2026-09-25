import { HubSection } from "@/components/hub/hub-section";
import { PageTransition } from "@/components/hub/page-transition";
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  return <PageTransition><HubSection section={section?.[0] ?? "dashboard"} /></PageTransition>;
}
