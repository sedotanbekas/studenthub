"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { checklistTermNotice } from "@/lib/frontend/academics-rules";
import { checklistComplete, isSchoolSetupFacts, schoolSetupSteps, type SchoolSetupFacts } from "@/lib/frontend/onboarding-rules";
import { ChecklistCard } from "./checklist-card";
import { HubLink as Link } from "./hub-link";
import { Icon } from "./icon";

/**
 * Beranda admin sekolah: (1) sebab-akibat semester hari ini ("siswa belum bisa absen") dan (2) kartu "Siapkan
 * sekolahmu" selama langkah wajib belum selesai. Satu kali GET /school/profile untuk keduanya.
 */
export function SchoolSetupPanel() {
  const [profile, setProfile] = useState<SchoolSetupFacts | null>(null);
  useEffect(() => {
    let active = true;
    api("/school/profile")
      .then((r) => { if (active && isSchoolSetupFacts(r.data)) setProfile(r.data); })
      // Pelengkap Beranda: galat profil tidak menghalangi halaman (galat utama sudah tampil dari ringkasan).
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!profile) return null;
  const notice = checklistTermNotice(profile.setupChecklist);
  const steps = schoolSetupSteps(profile);
  return <>
    {notice && <div className={`${notice.tone}-message acad-inline-notice`} role="status">
      <Icon name={notice.tone === "warning" ? "help" : "calendar"} size={18} />
      <span className="notice-text">{notice.text}</span>
      {notice.tone === "warning" && <Link href="/hub/academics" className="button secondary small-button">Atur semester<Icon name="arrow" size={15} /></Link>}
    </div>}
    {!checklistComplete(steps) && <ChecklistCard eyebrow="Persiapan sekolah" title="Siapkan sekolahmu" intro="Selesaikan langkah wajib agar siswa bisa masuk dan absen. Langkah opsional boleh menyusul." steps={steps} />}
  </>;
}
