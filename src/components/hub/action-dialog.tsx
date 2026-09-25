"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { resolveSchema } from "@/lib/frontend/catalog";
import type { Operation, Row, Schema } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Fields, defaults } from "./fields";
import { Details } from "./data-view";
import { Icon } from "./icon";

export function actionTitle(op: Operation) {
  const endings: Record<string, string> = { activate: "Aktifkan", deactivate: "Nonaktifkan", approve: "Setujui", reject: "Tolak", cancel: "Batalkan", publish: "Terbitkan", unpublish: "Tarik penerbitan", pause: "Jeda", resume: "Lanjutkan", submit: "Ajukan tinjauan", withdraw: "Tarik pengajuan", archive: "Arsipkan", void: "Batalkan", restore: "Pulihkan", "reset-password": "Reset kata sandi", "revoke-sessions": "Cabut semua sesi", "read-all": "Tandai semua dibaca", read: "Tandai sudah dibaca" };
  return endings[op.path.split("/").pop()!] ?? op.title.replace(/\s*\([^)]*\)/g, "").replace(/ \+ /g, " & ").replace("multipart", "").replace("DRAFT", "draf").replace("Ledger", "Riwayat");
}
export function parameterSchema(op: Operation, location?: string): Schema {
  const params = op.parameters.filter(p => p.name !== "schoolId" && (!location || p.in === location));
  const resource = op.path.split("/{")[0]!;
  const lookup = resource === "/school/terms" ? "/school/academic-years#terms" : operationsWithList(resource) ? resource : undefined;
  return { type: "object", properties: Object.fromEntries(params.map(p => [p.name, p.in === "path" && p.name === "id" && lookup ? { ...p.schema, lookup } : p.schema])), required: params.filter(p => p.required).map(p => p.name) };
}
function operationsWithList(resource: string) { return ["students", "classes", "subjects", "academic-years", "report-cards", "invoices", "leave-requests", "payment-submissions", "announcements", "schools", "users", "sponsors", "topups", "ads", "holidays", "sessions"].some(name => resource.endsWith(`/${name}`)); }
export function buildPath(op: Operation, values: Row): string {
  let path = op.path;
  const query = new URLSearchParams();
  for (const p of op.parameters) {
    const value = values[p.name];
    if (value === undefined || value === null || value === "") continue;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(value)));
    else if (p.in === "query") query.set(p.name, String(value));
  }
  return `${path}${query.size ? `?${query}` : ""}`;
}
export function cleanBody(value: Row, input: Schema): Row {
  const schema = resolveSchema(input, value);
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, item]) => {
    const stored = value[key];
    const field = resolveSchema(item, stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Row : undefined);
    const v = field.const ?? value[key];
    if (v === undefined || v === "") return [];
    if (field.format === "date-time" && typeof v === "string") return [[key, new Date(v).toISOString()]];
    if (field.type === "object" && v && typeof v === "object") return [[key, cleanBody(v as Row, field)]];
    if (field.type === "array" && Array.isArray(v) && resolveSchema(field.items).type === "object") return [[key, v.map(row => cleanBody(row as Row, field.items!))]];
    return [[key, v]];
  }));
}
function makeBody(values: Row, op: Operation): BodyInit | undefined {
  if (!op.body) return undefined;
  const cleaned = cleanBody(values, op.body);
  if (!op.multipart) return JSON.stringify(cleaned);
  const form = new FormData();
  for (const [key, value] of Object.entries(cleaned)) if (value !== undefined && value !== null) form.set(key, value instanceof File ? value : typeof value === "object" ? JSON.stringify(value) : String(value));
  return form;
}
interface DialogProps { op: Operation; initial?: Row; onClose: () => void; onDone: () => void }
export function ActionDialog({ op, initial = {}, onClose, onDone }: DialogProps) {
  const { schoolId, demo, toast, reloadMe } = useHub();
  const dialog = useRef<HTMLDialogElement>(null);
  const [values, setValues] = useState<Row>(() => defaults(op.body ?? {}, initial));
  const [params, setParams] = useState<Row>(() => ({ ...defaults(parameterSchema(op)), ...initial }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(undefined);
  const [errorDetails, setErrorDetails] = useState<unknown>(undefined);
  const danger = op.method === "DELETE" || /void|deactivate|reset-password|revoke|takedown|logout-all/.test(op.path);
  useEffect(() => { dialog.current?.showModal(); const element = dialog.current; return () => element?.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setErrorDetails(undefined);
    if (demo) { setError("Mode demo digunakan untuk menjelajahi formulir. Keluar dari demo dan masuk dengan akun untuk menyimpan data."); return; }
    setBusy(true);
    try {
      const response = await api(scoped(buildPath(op, params), schoolId), { method: op.method, body: makeBody(values, op) });
      setResult(response.data ?? { message: "Perubahan berhasil disimpan." });
      onDone(); toast(op.method === "GET" ? "Data berhasil dimuat." : "Perubahan berhasil disimpan.");
      if (op.path === "/auth/change-password" || op.path === "/me/totp/confirm") await reloadMe();
      if (op.path === "/auth/logout-all") window.dispatchEvent(new Event("studenthub:expired"));
    } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); if (e && typeof e === "object" && "details" in e) setErrorDetails(e.details); }
    finally { setBusy(false); }
  }
  const editableParams = parameterSchema({ ...op, parameters: op.parameters.filter(p => !(p.in === "path" && initial[p.name])) });
  return <dialog ref={dialog} className="action-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}><div className="dialog-heading"><div><span className="eyebrow">{op.method === "GET" ? "LIHAT INFORMASI" : "KELOLA DATA"}</span><h2>{actionTitle(op)}</h2></div><button className="icon-button" aria-label="Tutup dialog" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
    {result !== undefined ? <><div className="dialog-body"><div className="success-message"><Icon name="check" size={19} />{op.method === "GET" ? "Informasi berhasil dimuat." : "Berhasil. Perubahanmu sudah tersimpan."}</div><Details value={result} /></div><div className="dialog-footer"><button className="button secondary" onClick={() => window.print()}><Icon name="download" size={15} />Cetak / PDF</button><button className="button primary" onClick={onClose}>Selesai</button></div></> : <form onSubmit={submit}><div className="dialog-body">{demo && <div className="info-message">Kamu sedang melihat formulir demo. Masuk dengan akun untuk menyimpan data.</div>}{op.id === "importSchoolStudents" && <div className="info-message">Mulai dengan pratinjau untuk memeriksa berkas. Setelah hasilnya sesuai, nonaktifkan pratinjau untuk menyimpan.</div>}{op.id === "setupMyTotp" && <p>Siapkan aplikasi autentikator. Kunci rahasia akan ditampilkan satu kali; tambahkan kunci ke aplikasi, lalu gunakan tindakan “Konfirmasi pendaftaran TOTP” untuk memasukkan kodenya.</p>}
      <Fields schema={editableParams} value={params} onChange={setParams} />{op.body && <Fields schema={op.body} value={values} onChange={setValues} />}
      {!op.body && Object.keys(editableParams.properties ?? {}).length === 0 && <p>Jalankan tindakan <strong>{actionTitle(op).toLowerCase()}</strong>{initial.name ? ` untuk ${String(initial.name)}` : ""}?</p>}
      {danger && <label className="check-field danger-confirm"><input type="checkbox" required /><span>Saya memahami dampaknya dan ingin melanjutkan tindakan ini.</span></label>}
      {error && <div className="error-message" role="alert">{error}</div>}{errorDetails !== undefined && <Details value={errorDetails} />}</div><div className="dialog-footer"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Batal</button><button className={`button ${danger ? "danger" : "primary"}`} disabled={busy}>{busy ? "Memproses…" : op.method === "GET" ? "Tampilkan" : "Simpan & lanjutkan"}<Icon name="arrow" size={16} /></button></div></form>}
  </dialog>;
}
