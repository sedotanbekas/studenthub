"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import { prefsSavedMessage, prefsSummary } from "@/lib/frontend/notification-prefs-rules";
import { normalizeMutedCategories, type AdminMutableCategory } from "@/lib/notifications/rules";
import type { NotificationPreferencesDto } from "@/lib/notifications/schemas";
import { useHub } from "./context";
import { NotificationCategoriesField } from "./notification-categories-field";
import { DEMO_MESSAGE, SecurityCard } from "./security-card";

/**
 * Kartu "Kabar sekolah untuk akun ini" di halaman Notifikasi (admin sekolah, N2): ringkasan + Atur -> centang per
 * kategori -> Simpan pilihan. Gagal memuat TIDAK pernah ditampilkan sebagai "semua dikirim".
 */
interface Load { readonly data: NotificationPreferencesDto | null; readonly error: string }

const LOAD_ERROR = "Pilihan notifikasi belum berhasil dimuat.";
const isPreferences = (value: unknown): value is NotificationPreferencesDto =>
  typeof value === "object" && value !== null && Array.isArray((value as { mutedCategories?: unknown }).mutedCategories);

function useMyPreferences(version: number): Load {
  const { demo } = useHub();
  const [state, setState] = useState<Load>({ data: null, error: "" });
  useEffect(() => {
    let active = true;
    const load = demo ? Promise.resolve(demoRows("/me/notification-preferences") as NotificationPreferencesDto) : api("/me/notification-preferences").then(r => r.data as NotificationPreferencesDto);
    load.then(data => {
      if (!active) return;
      // Respons tak terduga = galat (jangan pernah dianggap "semua dikirim", jangan merusak halaman).
      setState(isPreferences(data) ? { data, error: "" } : { data: null, error: LOAD_ERROR });
    }, (e: unknown) => { if (active) setState({ data: null, error: e instanceof Error ? e.message : LOAD_ERROR }); });
    return () => { active = false; };
  }, [demo, version]);
  return state;
}

const changedBy = (data: NotificationPreferencesDto, myId: string): string | null =>
  data.updatedBy && data.updatedBy.id !== myId && data.updatedAt ? `Diatur oleh ${data.updatedBy.name} pada ${new Date(data.updatedAt).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}.` : null;

export function NotificationPrefsCard() {
  const { me } = useHub();
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const { data, error } = useMyPreferences(version);
  if (error) {
    return <SecurityCard icon="bell" title="Kabar sekolah untuk akun ini" text={LOAD_ERROR}>{error !== LOAD_ERROR && <p className="error-message" role="alert">{error}</p>}<button type="button" className="button secondary small-button" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></SecurityCard>;
  }
  if (!data) return <div className="skeleton notification-prefs-skeleton" role="status" aria-label="Memuat pilihan notifikasi" />;
  const muted = normalizeMutedCategories(data.mutedCategories);
  const note = changedBy(data, me.user.id);
  return <SecurityCard icon="bell" title="Kabar sekolah untuk akun ini" text={<>{prefsSummary(muted)}{note && <small className="muted notification-prefs-note">{note}</small>}</>}
    action={!editing ? <button type="button" className="button secondary small-button" onClick={() => setEditing(true)}>Atur</button> : undefined}>
    {editing && <PrefsEditor initial={muted} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setVersion(v => v + 1); }} />}
  </SecurityCard>;
}

function PrefsEditor({ initial, onCancel, onSaved }: { initial: AdminMutableCategory[]; onCancel: () => void; onSaved: () => void }) {
  const { demo, toast } = useHub();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = draft.join() !== initial.join();
  async function save() {
    setError("");
    if (demo) { setError(DEMO_MESSAGE); return; }
    setBusy(true);
    try {
      const result = (await api("/me/notification-preferences", { method: "PUT", body: JSON.stringify({ mutedCategories: draft }) })).data as NotificationPreferencesDto;
      toast(prefsSavedMessage(normalizeMutedCategories(result.mutedCategories)));
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Pilihan belum tersimpan."); }
    finally { setBusy(false); }
  }
  return <div className="notification-prefs-editor">
    <NotificationCategoriesField value={draft} onChange={setDraft} disabled={busy} />
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="dialog-footer-inline"><button type="button" className="button secondary small-button" disabled={busy} onClick={onCancel}>Batal</button><button type="button" className="button primary small-button" disabled={busy || !changed} onClick={() => void save()}>{busy ? "Menyimpan…" : "Simpan pilihan"}</button></div>
  </div>;
}
