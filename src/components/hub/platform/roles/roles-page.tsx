"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/frontend/api";
import { number } from "@/lib/frontend/format";
import { roleLabels } from "@/lib/frontend/modules";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "../../context";
import { Icon } from "../../icon";
import { RoleEditor } from "./role-editor";
import type { AccessRole, CatalogGroup } from "./types";

/**
 * Peran & hak akses (RBAC, permintaan pemilik 2026-10-07): daftar peran per jenis akun, buat peran baru
 * (boleh menyalin peran lain), lalu centang hak per fitur di editor. Hak berlaku seketika setelah disimpan.
 */
const BASES = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT", "REGION_ADMIN"] as const;

export function RolesPage({ module }: { module: Module }) {
  const { demo, me } = useHub();
  const [roles, setRoles] = useState<AccessRole[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogGroup[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const canManage = me.permissions.includes("roles.manage");

  const load = useCallback(async () => {
    try {
      const [list, cat] = await Promise.all([api("/access-roles"), api("/access-roles/catalog")]);
      setRoles(list.data as AccessRole[]); setCatalog(cat.data as CatalogGroup[]); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal memuat peran."); }
  }, []);
  useEffect(() => { if (!demo) void Promise.resolve().then(load); }, [demo, load]);

  if (demo) return <section className="panel roles-intro"><h1>{module.title}</h1><div className="info-message">Peran & hak akses memakai data sungguhan. Masuk dengan akun super admin untuk mengatur peran.</div></section>;
  const current = roles?.find(r => r.id === selected) ?? null;
  return <div className="roles-page">
    <header className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div>
      {canManage && <button className="button primary" onClick={() => { setCreating(true); setSelected(null); }}><Icon name="plus" size={18} />Peran baru</button>}</header>
    {error && <div className="error-message" role="alert">{error}</div>}
    {!roles ? <div className="skeleton" /> : <div className="roles-layout">
      <RoleList roles={roles} selected={selected} onSelect={id => { setSelected(id); setCreating(false); }} />
      <div className="roles-detail">
        {creating && <CreateRole roles={roles} onCancel={() => setCreating(false)} onCreated={async id => { await load(); setCreating(false); setSelected(id); }} />}
        {!creating && current && <RoleEditor key={current.id} role={current} catalog={catalog} canManage={canManage} onChanged={load} onDeleted={async () => { setSelected(null); await load(); }} />}
        {!creating && !current && <div className="panel roles-empty"><Icon name="shield" size={28} /><p>Pilih peran di kiri untuk melihat dan mencentang hak aksesnya.</p></div>}
      </div>
    </div>}
  </div>;
}

function RoleList({ roles, selected, onSelect }: { roles: AccessRole[]; selected: string | null; onSelect: (id: string) => void }) {
  return <nav className="panel roles-list" aria-label="Daftar peran">{BASES.map(base => {
    const items = roles.filter(r => r.baseRole === base);
    if (!items.length) return null;
    return <div key={base} className="roles-list-group"><span className="nav-label">{roleLabels[base]}</span>
      {items.map(r => <button key={r.id} type="button" className={`roles-list-item${selected === r.id ? " active" : ""}`} aria-current={selected === r.id ? "true" : undefined} onClick={() => onSelect(r.id)}>
        <span><strong>{r.name}</strong><small>{r.isSystem ? "Peran bawaan" : "Peran buatan"} · {number(r.userCount)} akun · {r.permissions.length}/{r.availablePermissions.length} hak</small></span>
        <Icon name="arrow" size={16} />
      </button>)}
    </div>;
  })}</nav>;
}

function CreateRole({ roles, onCancel, onCreated }: { roles: AccessRole[]; onCancel: () => void; onCreated: (id: string) => Promise<void> }) {
  const [baseRole, setBaseRole] = useState<string>("SCHOOL_ADMIN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sources = roles.filter(r => r.baseRole === baseRole);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const copyFromId = String(form.get("copyFromId") ?? "");
    const body = { name: String(form.get("name") ?? ""), description: String(form.get("description") ?? "") || undefined, baseRole, ...(copyFromId ? { copyFromId } : {}) };
    try { const r = await api("/access-roles", { method: "POST", body: JSON.stringify(body) }); await onCreated((r.data as AccessRole).id); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat peran."); }
    finally { setBusy(false); }
  }
  return <form className="panel roles-create" onSubmit={submit}><h2>Peran baru</h2>
    <p className="muted">Peran berlaku untuk satu jenis akun. Setelah dibuat, centang hak aksesnya lalu pasang ke akun lewat menu Pengguna atau Admin &amp; guru.</p>
    <div className="form-grid">
      <label className="field">Nama peran<input name="name" required minLength={3} maxLength={100} placeholder="mis. Guru piket, Bendahara, Admin platform terbatas" /></label>
      <label className="field">Jenis akun<select value={baseRole} onChange={e => setBaseRole(e.target.value)}>{BASES.map(b => <option key={b} value={b}>{roleLabels[b]}</option>)}</select></label>
      <label className="field full-width">Keterangan (opsional)<input name="description" maxLength={500} placeholder="Untuk apa peran ini dipakai" /></label>
      <label className="field full-width">Salin centang dari<select name="copyFromId" defaultValue={sources.find(s => s.isSystem)?.id ?? ""} key={baseRole}><option value="">Kosong (hanya hak dasar)</option>{sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </div>
    {error && <div className="error-message" role="alert">{error}</div>}
    <div className="roles-actions"><button type="button" className="button secondary" onClick={onCancel}>Batal</button><button className="button primary" disabled={busy}>{busy ? "Membuat…" : "Buat peran"}</button></div>
  </form>;
}
