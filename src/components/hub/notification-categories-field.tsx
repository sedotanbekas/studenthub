"use client";
import { CATEGORY_HINTS, PREFS_FOOTNOTE, categoryLabel, toggleMuted } from "@/lib/frontend/notification-prefs-rules";
import { ADMIN_MUTABLE_CATEGORIES, normalizeMutedCategories, type AdminMutableCategory } from "@/lib/notifications/rules";

/**
 * Pilihan kabar sekolah untuk satu akun admin (N2): satu kotak centang per kategori, DICENTANG = DITERIMA. Nilai yang
 * dikirim = daftar kategori yang DIMATIKAN. Dipakai kartu Notifikasi (akun sendiri) dan aksi "Atur notifikasi".
 */
const asMuted = (value: unknown): AdminMutableCategory[] => (Array.isArray(value) ? normalizeMutedCategories(value.filter((v): v is AdminMutableCategory => typeof v === "string") as AdminMutableCategory[]) : []);

export function NotificationCategoriesField({ value, onChange, disabled = false }: { value: unknown; onChange: (next: AdminMutableCategory[]) => void; disabled?: boolean }) {
  const muted = asMuted(value);
  return <fieldset className="nested-field notification-categories">
    <legend>Kabar yang dikirim</legend>
    {ADMIN_MUTABLE_CATEGORIES.map(category => <label key={category} className="check-field">
      <input type="checkbox" disabled={disabled} checked={!muted.includes(category)} onChange={e => onChange(toggleMuted(muted, category, e.target.checked))} />
      <span>{categoryLabel(category)}<small>{CATEGORY_HINTS[category]}</small></span>
    </label>)}
    <small className="field-hint">{PREFS_FOOTNOTE}</small>
  </fieldset>;
}
