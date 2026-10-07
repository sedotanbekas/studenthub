"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { groupSummary } from "@/lib/frontend/account-rules";
import { api } from "@/lib/frontend/api";
import { operation } from "@/lib/frontend/catalog";
import { demoRows } from "@/lib/frontend/demo";
import { demoAccountCounts } from "@/lib/frontend/demo-accounts";
import { number } from "@/lib/frontend/format";
import type { Module, Row } from "@/lib/frontend/types";
import { ActionDialog } from "../action-dialog";
import { useHub } from "../context";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { AccountList } from "./accounts/account-list";
import { usePaged, type Paged } from "./accounts/use-paged";

/**
 * Pengguna (super admin): akun dikelompokkan per sekolah (+ super admin & sponsor), tiap grup bisa dibuka-tutup dan
 * baru memuat akunnya saat dibuka. Kolom cari = pencarian semua akun (nama/email/NISN) dalam satu daftar.
 */
const SEARCH_DELAY_MS = 300;
const SCHOOL_PAGE_SIZE = 20;

interface SchoolGroupRow { readonly id: string; readonly name: string; readonly npsn: string | null; readonly isActive: boolean; readonly accountCounts: { readonly schoolAdmins: number; readonly students: number } }
interface GroupSection { readonly label: string; readonly query: string; readonly emptyText: string; readonly searchable?: boolean }

function AccountGroup({ title, subtitle, icon, sections, href }: { title: string; subtitle: string; icon: string; sections: readonly GroupSection[]; href?: string }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return <section className={`panel account-group${open ? " open" : ""}`}>
    <div className="account-group-head">
      <button type="button" className="account-group-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
        <span className="module-icon"><Icon name={icon} size={20} /></span>
        <span className="account-group-title"><strong>{title}</strong><small>{subtitle}</small></span>
        <Icon name="down" size={18} />
      </button>
      {href && <HubLink className="text-button" href={href}>Detail sekolah <Icon name="arrow" size={15} /></HubLink>}
    </div>
    <div id={bodyId} className="account-group-body" hidden={!open}>
      {open && sections.map(section => <div key={section.label} className="account-group-section"><h3>{section.label}</h3><AccountList query={section.query} emptyText={section.emptyText} searchable={section.searchable} /></div>)}
    </div>
  </section>;
}

function loadSchools(page: number, demo: boolean): Promise<Paged<SchoolGroupRow>> {
  if (demo) {
    const rows = (demoRows("/platform/schools") as Row[]).map(r => ({ id: String(r.id), name: String(r.name), npsn: (r.npsn as string | null) ?? null, isActive: r.isActive !== false, accountCounts: demoAccountCounts(String(r.id)) }));
    return Promise.resolve({ rows, total: rows.length, totalPages: 1 });
  }
  return api(`/platform/schools?page=${page}&limit=${SCHOOL_PAGE_SIZE}`).then(r => {
    const rows = (r.data ?? []) as SchoolGroupRow[];
    return { rows, total: r.meta?.total ?? rows.length, totalPages: r.meta?.totalPages ?? 1 };
  });
}

function schoolSections(id: string): GroupSection[] {
  const base = `schoolId=${encodeURIComponent(id)}`;
  return [
    { label: "Admin & guru", query: `${base}&role=SCHOOL_ADMIN`, emptyText: "Belum ada akun admin." },
    { label: "Siswa", query: `${base}&role=STUDENT`, emptyText: "Belum ada akun siswa.", searchable: true },
  ];
}

function SchoolGroups() {
  const { demo } = useHub();
  const load = useCallback((page: number) => loadSchools(page, demo), [demo]);
  const schools = usePaged(load, "Daftar sekolah belum berhasil dimuat.");
  if (schools.error && schools.rows.length === 0) return <div className="error-message" role="alert">{schools.error}</div>;
  if (schools.loading && schools.rows.length === 0) return <div className="table-loading" role="status" aria-label="Memuat sekolah">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div>;
  return <>
    {schools.rows.map(school => <AccountGroup key={school.id} title={school.name} icon="school" href={`/hub/schools/${encodeURIComponent(school.id)}`}
      subtitle={`${school.npsn ? `NPSN ${school.npsn} · ` : ""}${groupSummary(school.accountCounts)}${school.isActive ? "" : " · nonaktif"}`} sections={schoolSections(school.id)} />)}
    {schools.error && <div className="error-message" role="alert">{schools.error}</div>}
    {schools.hasMore && <button type="button" className="button secondary" disabled={schools.loading} onClick={schools.loadMore}>{schools.loading ? "Memuat…" : schools.error ? "Coba lagi" : `Muat sekolah lainnya (${number(schools.rows.length)} dari ${number(schools.total)})`}</button>}
  </>;
}

function useDebounced(text: string): string {
  const [value, setValue] = useState("");
  useEffect(() => { const timer = setTimeout(() => setValue(text.trim()), SEARCH_DELAY_MS); return () => clearTimeout(timer); }, [text]);
  return value;
}

export function UsersPage({ module }: { module: Module }) {
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);
  const q = useDebounced(text);
  return <div className="workspace-page accounts-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div>
      <div className="heading-actions"><button type="button" className="button primary" onClick={() => setCreating(true)}><Icon name="plus" size={17} />Akun baru</button></div></div>
    <div className="table-search accounts-search"><Icon name="search" size={17} /><input aria-label="Cari semua akun" placeholder="Cari nama, email, atau NISN di semua sekolah…" value={text} onChange={e => setText(e.target.value)} /></div>
    {q
      ? <section className="panel account-search-results"><AccountList key={`${q}|${version}`} query={`q=${encodeURIComponent(q)}`} showSchool emptyText={`Tidak ada akun yang cocok dengan "${q}".`} /></section>
      : <div className="account-groups" key={version}>
        <AccountGroup title="Super admin" icon="shield" subtitle="Akun pengelola platform" sections={[{ label: "Super admin", query: "role=SUPER_ADMIN", emptyText: "Belum ada akun super admin." }]} />
        <AccountGroup title="Admin Pemda" icon="location" subtitle="Pemerintah daerah: memantau sekolah di provinsi/kabupaten/kota wilayahnya" sections={[{ label: "Admin Pemda", query: "role=REGION_ADMIN", emptyText: "Belum ada akun Admin Pemda." }]} />
        <AccountGroup title="Sponsor" icon="heart" subtitle="Akun mitra pengiklan" sections={[{ label: "Sponsor", query: "role=SPONSOR", emptyText: "Belum ada akun sponsor.", searchable: true }]} />
        <SchoolGroups />
      </div>}
    {creating && <ActionDialog op={operation("createPlatformUser")} onClose={() => setCreating(false)} onDone={() => setVersion(v => v + 1)} />}
  </div>;
}
