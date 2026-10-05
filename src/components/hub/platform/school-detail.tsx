"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/frontend/api";
import { operation } from "@/lib/frontend/catalog";
import { demoRows } from "@/lib/frontend/demo";
import { demoAccountCounts } from "@/lib/frontend/demo-accounts";
import { number } from "@/lib/frontend/format";
import type { Operation, Row } from "@/lib/frontend/types";
import { ActionDialog } from "../action-dialog";
import { Segmented } from "../charts/segmented";
import { useHub } from "../context";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { capturePage } from "../page-slide";
import { AccountList } from "./accounts/account-list";
import { errorText } from "./review-hooks";

/** Detail sekolah super admin (/hub/schools/<id>): ringkasan, tindakan sekolah, dan akun admin & siswa beserta kredensialnya. */
interface SchoolDetailDto {
  readonly id: string;
  readonly name: string;
  readonly npsn: string | null;
  readonly isActive: boolean;
  readonly province?: { readonly name: string } | null;
  readonly city?: { readonly name: string } | null;
  readonly counts: { readonly studentsByStatus: Readonly<Record<string, number>>; readonly adminCount: number };
}
type Tab = "admins" | "students";
type ActionState = { op: Operation; initial?: Row } | null;

function demoSchool(id: string): SchoolDetailDto | null {
  const row = (demoRows("/platform/schools") as Row[]).find(s => s.id === id);
  if (!row) return null;
  const counts = demoAccountCounts(id);
  return { id, name: String(row.name), npsn: (row.npsn as string | null) ?? null, isActive: row.isActive !== false, counts: { studentsByStatus: { ACTIVE: counts.students }, adminCount: counts.schoolAdmins } };
}

function useSchool(id: string, version: number): { school: SchoolDetailDto | null; error: string } {
  const { demo } = useHub();
  const [state, setState] = useState<{ school: SchoolDetailDto | null; error: string }>({ school: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = demo ? Promise.resolve(demoSchool(id)) : api(`/platform/schools/${encodeURIComponent(id)}`).then(r => r.data as SchoolDetailDto);
    load.then(school => { if (active) setState(school ? { school, error: "" } : { school: null, error: "Sekolah tidak ditemukan." }); })
      .catch(e => { if (active) setState({ school: null, error: errorText(e, "Detail sekolah belum berhasil dimuat.") }); });
    return () => { active = false; };
  }, [id, demo, version]);
  return state;
}

const studentTotal = (school: SchoolDetailDto): number => Object.values(school.counts.studentsByStatus).reduce((sum, n) => sum + n, 0);

function SchoolHeading({ school, onAction }: { school: SchoolDetailDto; onAction: (action: ActionState) => void }) {
  const router = useRouter();
  const { setSchoolId } = useHub();
  const place = [school.city?.name, school.province?.name].filter(Boolean).join(", ");
  const toggle = operation(school.isActive ? "deactivatePlatformSchool" : "reactivatePlatformSchool");
  const manage = () => { setSchoolId(school.id); capturePage("forward"); router.push("/hub/students", { scroll: false }); };
  return <div className="page-heading school-detail-heading">
    <div>
      <HubLink className="text-button back-link" href="/hub/schools"><Icon name="back" size={16} />Semua sekolah</HubLink>
      <h1>{school.name}</h1>
      <p>{[school.npsn ? `NPSN ${school.npsn}` : "Belum ada NPSN", place].filter(Boolean).join(" · ")} <span className={`status ${school.isActive ? "green" : "red"}`}><i />{school.isActive ? "Aktif" : "Nonaktif"}</span></p>
    </div>
    <div className="heading-actions">
      <button type="button" className="button primary" onClick={manage}><Icon name="arrow" size={16} />Kelola data sekolah</button>
      <button type="button" className="button secondary" onClick={() => onAction({ op: operation("updatePlatformSchool"), initial: school as unknown as Row })}>Ubah data sekolah</button>
      {toggle && <button type="button" className="button secondary" onClick={() => onAction({ op: toggle, initial: { id: school.id, name: school.name } })}>{school.isActive ? "Nonaktifkan" : "Aktifkan kembali"}</button>}
    </div>
  </div>;
}

function SchoolStats({ school }: { school: SchoolDetailDto }) {
  const byStatus = school.counts.studentsByStatus;
  const items: [string, number][] = [["Siswa aktif", byStatus.ACTIVE ?? 0], ["Siswa draf", byStatus.DRAFT ?? 0], ["Nonaktif, lulus, pindah", (byStatus.INACTIVE ?? 0) + (byStatus.GRADUATED ?? 0) + (byStatus.MOVED ?? 0)], ["Admin & guru", school.counts.adminCount]];
  return <div className="school-stats">{items.map(([label, value]) => <div key={label} className="school-stat"><strong>{number(value)}</strong><span>{label}</span></div>)}</div>;
}

function SchoolAccounts({ school, onAction, version }: { school: SchoolDetailDto; onAction: (action: ActionState) => void; version: number }) {
  const [tab, setTab] = useState<Tab>("admins");
  const options = [{ value: "admins" as const, label: `Admin & guru (${number(school.counts.adminCount)})` }, { value: "students" as const, label: `Siswa (${number(studentTotal(school))})` }];
  const base = `schoolId=${encodeURIComponent(school.id)}`;
  return <section className="panel school-accounts">
    <div className="school-accounts-top">
      <Segmented options={options} value={tab} onChange={setTab} ariaLabel="Jenis akun" />
      {tab === "admins" && <button type="button" className="button secondary small-button" onClick={() => onAction({ op: operation("createPlatformUser"), initial: { role: "SCHOOL_ADMIN", schoolId: school.id } })}><Icon name="plus" size={15} />Tambah admin</button>}
    </div>
    {tab === "admins"
      ? <AccountList key={`a${version}`} query={`${base}&role=SCHOOL_ADMIN`} emptyText="Sekolah ini belum punya akun admin." />
      : <AccountList key={`s${version}`} searchable query={`${base}&role=STUDENT`} emptyText="Sekolah ini belum punya akun siswa." />}
  </section>;
}

export function SchoolDetail({ id }: { id: string }) {
  const [version, setVersion] = useState(0);
  const [action, setAction] = useState<ActionState>(null);
  const { school, error } = useSchool(id, version);
  if (!school) {
    return <div className="workspace-page">{error
      ? <div className="empty-state"><h2>{error}</h2><HubLink className="button primary" href="/hub/schools">Kembali ke daftar sekolah</HubLink></div>
      : <div className="table-loading" role="status" aria-label="Memuat detail sekolah">{[1, 2, 3].map(i => <div className="skeleton" key={i} />)}</div>}</div>;
  }
  return <div className="workspace-page school-detail">
    <SchoolHeading school={school} onAction={setAction} />
    <SchoolStats school={school} />
    <SchoolAccounts school={school} onAction={setAction} version={version} />
    {action && <ActionDialog key={action.op.id} op={action.op} initial={action.initial} onClose={() => setAction(null)} onDone={() => setVersion(v => v + 1)} />}
  </div>;
}
