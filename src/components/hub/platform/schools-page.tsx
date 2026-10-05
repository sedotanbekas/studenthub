"use client";
import { usePathname, useRouter } from "next/navigation";
import { sectionDetailId } from "@/lib/frontend/modules";
import type { Module, Row } from "@/lib/frontend/types";
import { capturePage } from "../page-slide";
import { Workspace } from "../workspace";
import { SchoolDetail } from "./school-detail";

/** Sekolah (super admin): daftar generik; memilih baris membuka halaman detail /hub/schools/<id> (bukan dialog). */
export function SchoolsPage({ module }: { module: Module }) {
  const pathname = usePathname();
  const router = useRouter();
  const id = sectionDetailId(pathname);
  if (id) return <SchoolDetail key={id} id={id} />;
  const open = (row: Row) => {
    if (!row.id) return;
    capturePage("forward");
    router.push(`/hub/schools/${encodeURIComponent(String(row.id))}`, { scroll: false });
  };
  return <Workspace module={module} onRowSelect={open} />;
}
