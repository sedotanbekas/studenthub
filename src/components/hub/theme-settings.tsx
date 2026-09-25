"use client";
import { useEffect, useRef, useState } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { applyTheme } from "@/lib/frontend/theme";
import type { SchoolThemeDto } from "@/lib/frontend/types";
import { DEFAULT_THEME, THEME_PRESETS, normalizeHex, resolveTheme, sameTheme, themeVariables, type SchoolThemeColors, type ThemeKey } from "@/lib/schools/theme-rules";
import { useHub } from "./context";
import { Icon } from "./icon";

/**
 * Tema sekolah: lima warna (primer, sekunder, banner, animasi, logo). Setiap perubahan langsung
 * dipratinjau di seluruh aplikasi; "Simpan" memberlakukannya untuk semua admin & siswa sekolah itu.
 * Warna apa pun diterima — turunan tema menjaga teks tetap terbaca (lihat theme-rules.ts).
 */
const FIELDS: readonly { key: ThemeKey; label: string; hint: string; token?: string }[] = [
  { key: "primaryColor", label: "Warna primer", hint: "Tombol utama, menu aktif, tautan, dan cincin fokus.", token: "--primary" },
  { key: "secondaryColor", label: "Warna sekunder", hint: "Avatar, ikon pendamping, dan aksen kedua.", token: "--secondary" },
  { key: "bannerColor", label: "Warna banner", hint: "Kartu identitas siswa, panel halaman masuk, dan bilah browser HP.", token: "--banner" },
  { key: "animationColor", label: "Warna animasi", hint: "Pendar latar, pemuat, kilau kartu, dan efek sentuh." },
  { key: "logoColor", label: "Warna logo", hint: "Tanda logo Student Hub dan ikon sekolah di menu.", token: "--logo" },
];

function useThemeEditor() {
  const { me, demo, schoolId } = useHub();
  const needsSchool = me.user.role === "SUPER_ADMIN" && !schoolId && !demo;
  const [saved, setSaved] = useState<SchoolThemeColors | null>(null);
  const [draft, setDraft] = useState<SchoolThemeColors | null>(null);
  const [error, setError] = useState("");
  const own = me.school?.theme;
  const ownRef = useRef(own);
  useEffect(() => { ownRef.current = own; }, [own]);
  useEffect(() => {
    if (needsSchool) return;
    let active = true;
    const load: Promise<SchoolThemeDto | SchoolThemeColors> = demo ? Promise.resolve(resolveTheme(own)) : api(scoped("/school/theme", schoolId)).then(r => r.data as SchoolThemeDto);
    load.then(dto => { if (active) { const colors = resolveTheme(dto); setSaved(colors); setDraft(colors); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Tema belum dapat dimuat."); });
    return () => { active = false; };
  }, [demo, schoolId, needsSchool, own]);
  // Pratinjau langsung; saat keluar halaman kembali ke tema milik akun ini.
  useEffect(() => {
    if (!draft) return;
    applyTheme(draft);
    return () => { const current = ownRef.current; applyTheme(current ? resolveTheme(current) : null); };
  }, [draft]);
  return { needsSchool, saved, setSaved, draft, setDraft, error, setError };
}

export function ThemeSettings() {
  const { me, demo, schoolId, toast, reloadMe, saveDemoTheme } = useHub();
  const { needsSchool, saved, setSaved, draft, setDraft, error, setError } = useThemeEditor();
  const [busy, setBusy] = useState(false);
  const canEdit = demo || me.permissions.includes("schools.theme.update");
  const dirty = Boolean(draft && saved && !sameTheme(draft, saved));
  const preset = draft ? THEME_PRESETS.find(p => sameTheme(p.colors, draft))?.key ?? null : null;
  async function persist(next: SchoolThemeColors | null) {
    setBusy(true); setError("");
    try {
      if (demo) saveDemoTheme(next);
      else if (next) await api(scoped("/school/theme", schoolId), { method: "PUT", body: JSON.stringify({ ...next, preset }) });
      else await api(scoped("/school/theme", schoolId), { method: "DELETE" });
      const applied = next ?? DEFAULT_THEME;
      setSaved(applied); setDraft(applied);
      if (!demo && me.school) await reloadMe();
      toast(next ? (demo ? "Tema demo diterapkan untuk sesi ini." : "Tema sekolah disimpan. Semua admin dan siswa melihat warna baru.") : "Tema dikembalikan ke bawaan Student Hub.");
    } catch (e) { setError(e instanceof Error ? e.message : "Tema belum tersimpan."); }
    finally { setBusy(false); }
  }
  return <div className="workspace-page theme-page">
    <div className="page-heading"><div><h1>Tema sekolah</h1><p>Sesuaikan warna aplikasi dengan identitas sekolah. Perubahan langsung terlihat sebagai pratinjau; simpan agar berlaku untuk semua admin dan siswa.</p></div></div>
    {needsSchool ? <div className="panel empty-state"><span className="empty-icon"><Icon name="school" size={30} /></span><h3>Pilih sekolah untuk memulai</h3><p>Gunakan pemilih sekolah di atas untuk mengatur tema sekolah tersebut.</p></div>
      : !draft ? error ? <p className="error-message" role="alert">{error}</p> : <div className="panel"><div className="skeleton" /><div className="skeleton" /></div>
      : <>
        <PresetPicker selected={preset} disabled={!canEdit} onPick={colors => setDraft(colors)} />
        <div className="theme-layout">
          <section className="panel" aria-labelledby="color-title"><div className="panel-heading"><h2 id="color-title">Warna</h2>{preset === null && <span className="pill">Kustom</span>}</div>
            <div className="color-fields">{FIELDS.map(f => <ColorField key={f.key} field={f} value={draft[f.key]} theme={draft} disabled={!canEdit} onChange={value => setDraft({ ...draft, [f.key]: value })} />)}</div></section>
          <ThemePreview name={me.school?.name ?? "Sekolah"} />
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {!canEdit && <p className="info-message">Akunmu hanya dapat melihat tema. Minta admin sekolah untuk mengubahnya.</p>}
        <div className="theme-actions"><button className="button secondary" disabled={!dirty || busy} onClick={() => saved && setDraft(saved)}>Batalkan perubahan</button><button className="button secondary" disabled={busy || !canEdit} onClick={() => void persist(null)}><Icon name="refresh" size={17} />Kembalikan bawaan</button><button className="button primary" disabled={!dirty || busy || !canEdit} onClick={() => void persist(draft)}><Icon name="check" size={18} />{busy ? "Menyimpan…" : "Simpan tema"}</button></div>
      </>}
  </div>;
}

function PresetPicker({ selected, disabled, onPick }: { selected: string | null; disabled: boolean; onPick: (colors: SchoolThemeColors) => void }) {
  return <section className="panel" aria-labelledby="preset-title"><div className="panel-heading"><div><h2 id="preset-title">Mulai dari palet</h2><p>Pilih palet lalu sesuaikan warnanya bila perlu.</p></div></div>
    <div className="preset-grid">{THEME_PRESETS.map(p => <button key={p.key} type="button" disabled={disabled} className={`preset-card ${selected === p.key ? "selected" : ""}`} aria-pressed={selected === p.key} onClick={() => onPick(p.colors)}><span className="preset-swatches" aria-hidden="true">{FIELDS.map(f => <i key={f.key} style={{ background: p.colors[f.key] }} />)}</span><strong>{p.label}</strong></button>)}</div></section>;
}

interface ColorFieldProps { field: (typeof FIELDS)[number]; value: string; theme: SchoolThemeColors; disabled: boolean; onChange: (value: string) => void }

function ColorField({ field, value, theme, disabled, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (synced !== value) { setSynced(value); setText(value); } // ikuti perubahan dari preset / batalkan
  const applied = field.token ? themeVariables(theme)[field.token] : undefined;
  const adjusted = applied !== undefined && applied !== value;
  const id = `color-${field.key}`;
  return <div className="color-field"><span className="color-swatch" style={{ background: value }}><input type="color" value={value} disabled={disabled} aria-label={`${field.label} (pemilih warna)`} onChange={e => onChange(normalizeHex(e.target.value) ?? value)} /></span>
    <div className="color-text"><label htmlFor={id}><strong>{field.label}</strong><small>{field.hint}</small></label>
      <input id={id} value={text} disabled={disabled} maxLength={7} spellCheck={false} autoComplete="off" aria-describedby={adjusted ? `${id}-note` : undefined} onChange={e => { setText(e.target.value); const hex = normalizeHex(e.target.value); if (hex) onChange(hex); }} onBlur={() => setText(value)} />
      {adjusted && <small id={`${id}-note`} className="color-note">Disesuaikan otomatis menjadi {applied} agar teks di atasnya tetap terbaca.</small>}</div></div>;
}

/** Contoh kecil permukaan bertema (banner & logo tidak selalu terlihat di halaman admin). */
function ThemePreview({ name }: { name: string }) {
  return <section className="panel theme-preview" aria-label="Pratinjau tema"><div className="panel-heading"><h2>Pratinjau</h2></div>
    <div className="preview-banner"><span className="brand-mark" aria-hidden="true"><Icon name="book" size={20} /></span><div><small>SISWA · X IPA 1</small><strong>Alya Putri Ramadhani</strong><span>{name}</span></div><b>07:15</b></div>
    <div className="preview-row"><span className="nav-item active"><Icon name="grid" />Beranda</span><span className="avatar">AP</span><span className="quick-icon tone-1"><Icon name="report" size={20} /></span><span className="loader" aria-hidden="true" /></div>
    <div className="preview-row"><span className="button primary">Tombol utama</span><span className="text-link">Tautan</span></div></section>;
}
