"use client";
import { useSections } from "./sections";

/**
 * Tempat isi satu bagian hub (dipakai app/hub/[[...section]]/page.tsx). Modul bagian dimuat terpisah
 * (sections.ts); HubShell baru merender halaman setelah modul siap, jadi di sini praktis selalu tersedia.
 */
export function SectionOutlet({ section }: { section: string }) {
  const { sections } = useSections();
  return sections ? <sections.HubSection section={section} /> : null;
}
