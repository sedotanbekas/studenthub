import { Hub } from "@/components/hub/hub";
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  return <Hub section={section?.[0] ?? "dashboard"} />;
}
