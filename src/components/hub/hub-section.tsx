"use client";
import { isKnownSection, isRestricted, resolveSection } from "@/lib/frontend/modules";
import { useHub } from "./context";
import { Dashboard } from "./dashboard";
import { HubLink } from "./hub-link";
import { Icon } from "./icon";
import { StudentHome } from "./student-home";
import { ThemeSettings } from "./theme-settings";
import { Workspace } from "./workspace";
import { AttendancePage } from "./attendance/attendance-page";

/** Isi satu bagian hub; alamat yang tidak dikenal -> "tidak ditemukan". */
export function HubSection({ section }: { section: string }) {
  const { me, demo, schoolId } = useHub();
  const { home, module } = resolveSection(me.user.role, isRestricted(me), section);
  if (module?.key === "my-attendance") return <AttendancePage key={me.user.id} />;
  if (module?.key === "school-theme") return <ThemeSettings key={`${schoolId}-${me.user.id}`} />;
  if (module) return <Workspace key={`${module.key}-${schoolId}-${demo}-${me.user.id}`} module={module} />;
  if (home) return me.user.role === "STUDENT" ? <StudentHome key={me.user.id} /> : <Dashboard key={me.user.id} />;
  // Bagian milik peran lain: HubShell sedang mengalihkan ke beranda.
  if (isKnownSection(section)) return <div className="panel" role="status" aria-label="Mengalihkan ke beranda"><div className="skeleton" /><div className="skeleton" /></div>;
  return <div className="empty-state"><Icon name="search" size={35} /><h2>Halaman tidak ditemukan</h2><HubLink className="button primary" href="/hub">Kembali ke beranda</HubLink></div>;
}
