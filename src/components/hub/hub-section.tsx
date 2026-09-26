"use client";
import { Fragment, type ReactNode } from "react";
import { isKnownSection, isRestricted, resolveSection } from "@/lib/frontend/modules";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Dashboard } from "./dashboard";
import { HubLink } from "./hub-link";
import { Icon } from "./icon";
import { StudentHome } from "./student-home";
import { ThemeSettings } from "./theme-settings";
import { Workspace } from "./workspace";
import { AttendancePage } from "./attendance/attendance-page";
import { AttendanceMonitorPage } from "./attendance-admin/attendance-monitor-page";
import { AdReviewPage } from "./platform/ad-review-page";
import { TopUpReviewPage } from "./platform/topup-review-page";
import { SponsorAnalyticsPage } from "./sponsor/analytics-page";
import { BalancePage } from "./sponsor/balance-page";
import { CampaignsPage } from "./sponsor/campaigns-page";

/** Halaman khusus per kunci modul; modul lain memakai Workspace generik berbasis katalog. */
const DEDICATED: Record<string, (module: Module) => ReactNode> = {
  "my-attendance": () => <AttendancePage />,
  "school-theme": () => <ThemeSettings />,
  attendance: module => <AttendanceMonitorPage module={module} />,
  campaigns: module => <CampaignsPage module={module} />,
  analytics: module => <SponsorAnalyticsPage module={module} />,
  balance: module => <BalancePage module={module} />,
  "ad-review": module => <AdReviewPage module={module} />,
  topups: module => <TopUpReviewPage module={module} />,
};

/** Isi satu bagian hub; alamat yang tidak dikenal -> "tidak ditemukan". */
export function HubSection({ section }: { section: string }) {
  const { me, demo, schoolId } = useHub();
  const { home, module } = resolveSection(me.user.role, isRestricted(me), section);
  // key: isi halaman di-reset per identitas, sekolah yang dikelola (super admin), dan mode demo.
  const key = `${module?.key}-${schoolId}-${demo}-${me.user.id}`;
  const dedicated = module ? DEDICATED[module.key] : undefined;
  if (module && dedicated) return <Fragment key={key}>{dedicated(module)}</Fragment>;
  if (module) return <Workspace key={key} module={module} />;
  if (home) return me.user.role === "STUDENT" ? <StudentHome key={me.user.id} /> : <Dashboard key={me.user.id} />;
  // Bagian milik peran lain: HubShell sedang mengalihkan ke beranda.
  if (isKnownSection(section)) return <div className="panel" role="status" aria-label="Mengalihkan ke beranda"><div className="skeleton" /><div className="skeleton" /></div>;
  return <div className="empty-state"><Icon name="search" size={35} /><h2>Halaman tidak ditemukan</h2><HubLink className="button primary" href="/hub">Kembali ke beranda</HubLink></div>;
}
