"use client";
import { useRouter } from "next/navigation";
import type { Module, Row } from "@/lib/frontend/types";
import { useHub } from "../context";
import { capturePage } from "../page-slide";
import { Workspace } from "../workspace";

/**
 * Sekolah wilayah Admin Pemda (2026-10-07): pilih satu sekolah -> sekolah itu menjadi "Sekolah yang dipantau" dan
 * datanya (siswa, kehadiran, tagihan, rapor, ...) langsung terbuka, baca saja.
 */
export function RegionSchoolsPage({ module }: { module: Module }) {
  const { setSchoolId, toast } = useHub();
  const router = useRouter();
  function open(row: Row) {
    if (typeof row.id !== "string") return;
    setSchoolId(row.id);
    toast(`Memantau ${String(row.name ?? "sekolah")}.`);
    capturePage("forward");
    router.push("/hub/students", { scroll: false });
  }
  return <Workspace module={module} onRowSelect={open} />;
}
