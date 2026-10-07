"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/frontend/api";
import { roleLabels } from "@/lib/frontend/modules";
import { useHub } from "../../context";
import { Icon } from "../../icon";
import type { AccessRole, AccessRoleMember, CatalogGroup, CatalogItem } from "./types";

/**
 * Editor satu peran: matriks centang hak per kelompok fitur (hanya hak yang mungkin untuk jenis akunnya),
 * hak terkunci tercentang & tidak bisa dicabut, cari, centang/kosongkan per kelompok, simpan, hapus (peran
 * buatan), dan daftar akun pemakainya.
 */
interface EditorProps { role: AccessRole; catalog: CatalogGroup[]; canManage: boolean; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }

export function RoleEditor({ role, catalog, canManage, onChanged, onDeleted }: EditorProps) {
  const { toast } = useHub();
  const [checked, setChecked] = useState(() => new Set(role.permissions));
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useMemo(() => new Set(role.lockedPermissions), [role.lockedPermissions]);
  const groups = useMemo(() => visibleGroups(catalog, role, filter), [catalog, role, filter]);
  const dirty = name !== role.name || description !== (role.description ?? "") || !sameSet(checked, role.permissions);

  function toggle(action: string, on: boolean) {
    if (locked.has(action)) return;
    setChecked(prev => { const next = new Set(prev); if (on) next.add(action); else next.delete(action); return next; });
  }
  async function save() {
    setBusy(true); setError("");
    try {
      await api(`/access-roles/${encodeURIComponent(role.id)}`, { method: "PATCH", body: JSON.stringify({ name, description: description || null, permissions: [...checked] }) });
      toast("Peran disimpan. Hak akses berlaku seketika."); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menyimpan."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm(`Hapus peran "${role.name}"? Akun pemakainya kembali ke peran bawaan ${roleLabels[role.baseRole]}.`)) return;
    setBusy(true); setError("");
    try { await api(`/access-roles/${encodeURIComponent(role.id)}`, { method: "DELETE" }); toast("Peran dihapus."); await onDeleted(); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal menghapus."); setBusy(false); }
  }

  return <section className="panel role-editor">
    <RoleHeader role={role} name={name} description={description} canManage={canManage} onName={setName} onDescription={setDescription} />
    <div className="role-toolbar">
      <input type="search" aria-label="Cari hak akses" placeholder="Cari hak akses…" value={filter} onChange={e => setFilter(e.target.value)} />
      <span className="pill">{checked.size}/{role.availablePermissions.length} hak dicentang</span>
    </div>
    <div className="perm-groups">{groups.map(g => <PermissionGroup key={g.group} group={g} checked={checked} locked={locked} disabled={!canManage || busy} onToggle={toggle} />)}</div>
    {error && <div className="error-message" role="alert">{error}</div>}
    {canManage && <div className="roles-actions sticky-actions">
      {!role.isSystem && <button type="button" className="button danger-outline" disabled={busy} onClick={() => void remove()}>Hapus peran</button>}
      <button type="button" className="button secondary" disabled={busy || !dirty} onClick={() => { setChecked(new Set(role.permissions)); setName(role.name); setDescription(role.description ?? ""); }}>Batalkan perubahan</button>
      <button type="button" className="button primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan peran"}<Icon name="check" size={17} /></button>
    </div>}
    <RoleMembers role={role} />
  </section>;
}

function RoleHeader({ role, name, description, canManage, onName, onDescription }: { role: AccessRole; name: string; description: string; canManage: boolean; onName: (v: string) => void; onDescription: (v: string) => void }) {
  return <div className="role-head">
    <div className="role-badges"><span className="pill">{roleLabels[role.baseRole]}</span>{role.isSystem && <span className="pill role-system"><Icon name="key" size={14} />Peran bawaan</span>}</div>
    <div className="form-grid">
      <label className="field">Nama peran<input value={name} disabled={!canManage} minLength={3} maxLength={100} onChange={e => onName(e.target.value)} /></label>
      <label className="field">Keterangan<input value={description} disabled={!canManage} maxLength={500} onChange={e => onDescription(e.target.value)} /></label>
    </div>
    {role.isSystem && <p className="field-hint">Peran bawaan dipakai semua akun {roleLabels[role.baseRole].toLowerCase()} yang belum dipasangi peran lain. Fitur baru otomatis tercentang di peran bawaan.</p>}
  </div>;
}

function PermissionGroup({ group, checked, locked, disabled, onToggle }: { group: CatalogGroup; checked: Set<string>; locked: Set<string>; disabled: boolean; onToggle: (action: string, on: boolean) => void }) {
  const free = group.items.filter(i => !locked.has(i.action));
  const allOn = free.every(i => checked.has(i.action));
  return <fieldset className="perm-group"><legend>{group.group}<span className="perm-count">{group.items.filter(i => checked.has(i.action)).length}/{group.items.length}</span></legend>
    {free.length > 0 && <button type="button" className="text-button perm-all" disabled={disabled} onClick={() => free.forEach(i => onToggle(i.action, !allOn))}>{allOn ? "Kosongkan kelompok" : "Centang semua"}</button>}
    {group.items.map(item => <PermissionRow key={item.action} item={item} on={checked.has(item.action)} isLocked={locked.has(item.action)} disabled={disabled} onToggle={onToggle} />)}
  </fieldset>;
}

function PermissionRow({ item, on, isLocked, disabled, onToggle }: { item: CatalogItem; on: boolean; isLocked: boolean; disabled: boolean; onToggle: (action: string, on: boolean) => void }) {
  return <label className={`perm-row${isLocked ? " locked" : ""}`}>
    <input type="checkbox" checked={on || isLocked} disabled={disabled || isLocked} onChange={e => onToggle(item.action, e.target.checked)} />
    <span><strong>{item.label}{isLocked && <Icon name="key" size={13} />}</strong><small>{item.hint}{isLocked ? " Selalu aktif." : ""}</small><code>{item.action}</code></span>
  </label>;
}

function RoleMembers({ role }: { role: AccessRole }) {
  const [members, setMembers] = useState<AccessRoleMember[] | null>(null);
  useEffect(() => {
    let active = true;
    api(`/access-roles/${encodeURIComponent(role.id)}`).then(r => { if (active) setMembers(((r.data as { members?: AccessRoleMember[] }).members) ?? []); }).catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [role.id, role.updatedAt]);
  return <div className="role-members"><h3>Akun pemakai ({role.userCount})</h3>
    <p className="field-hint">Pasang peran ke akun lewat menu Pengguna (super admin) atau Admin &amp; guru (admin utama sekolah).</p>
    {!members ? <div className="skeleton" /> : members.length === 0 ? <p className="muted">Belum ada akun yang memakai peran ini.</p> : <ul>{members.map(m => <li key={m.id}><strong>{m.name}</strong><small>{[m.email, m.schoolName, m.isActive ? null : "nonaktif"].filter(Boolean).join(" · ")}</small></li>)}</ul>}
  </div>;
}

function visibleGroups(catalog: CatalogGroup[], role: AccessRole, filter: string): CatalogGroup[] {
  const available = new Set(role.availablePermissions);
  const q = filter.trim().toLowerCase();
  return catalog
    .map(g => ({ group: g.group, items: g.items.filter(i => available.has(i.action) && (!q || `${i.label} ${i.hint} ${i.action} ${g.group}`.toLowerCase().includes(q))) }))
    .filter(g => g.items.length > 0);
}

function sameSet(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every(x => a.has(x));
}
