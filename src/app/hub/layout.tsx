import type { ReactNode } from "react";
import { HubShell } from "@/components/hub/hub";

/** Kerangka hub bertahan antarhalaman (sesi & tema tidak dimuat ulang saat pindah bagian). */
export default function HubLayout({ children }: { children: ReactNode }) {
  return <HubShell>{children}</HubShell>;
}
