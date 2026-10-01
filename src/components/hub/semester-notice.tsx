"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { checklistTermNotice, type Notice } from "@/lib/frontend/academics-rules";
import { HubLink as Link } from "./hub-link";
import { Icon } from "./icon";

interface ProfileChecklist { readonly setupChecklist: { readonly hasTermToday: boolean; readonly nextTermStartDate: string | null } }

/**
 * Beranda admin sekolah: sebab-akibat semester hari ini ("siswa belum bisa absen") dengan tombol yang langsung
 * membuka Akademik (panduan otomatis tampil bila semester belum ada). Diam bila semester berjalan normal.
 */
export function SemesterNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    let active = true;
    api("/school/profile")
      .then((r) => { if (active) setNotice(checklistTermNotice((r.data as ProfileChecklist).setupChecklist)); })
      // Pelengkap Beranda: galat profil tidak menghalangi halaman (galat utama sudah tampil dari ringkasan).
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!notice) return null;
  return <div className={`${notice.tone}-message acad-inline-notice`} role="status">
    <Icon name={notice.tone === "warning" ? "help" : "calendar"} size={18} />
    <span className="notice-text">{notice.text}</span>
    {notice.tone === "warning" && <Link href="/hub/academics" className="button secondary small-button">Atur semester<Icon name="arrow" size={15} /></Link>}
  </div>;
}
