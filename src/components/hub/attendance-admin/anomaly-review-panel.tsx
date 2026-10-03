"use client";
import { useId, useState } from "react";
import { invalidBlockedByWindow, REVIEW_NOTE_MAX, reviewNoteProblem, type ReviewDecision } from "@/lib/attendance/anomaly-review-rules";
import type { AnomalyReviewResultDto } from "@/lib/attendance/anomaly-review-schemas";
import type { RecordDetailDto } from "@/lib/attendance/monitor-schemas";
import { ApiError } from "@/lib/frontend/api";
import { label } from "@/lib/frontend/format";
import { toggleQuickReason } from "@/lib/frontend/review-rules";
import { useHub } from "../context";
import { INVALID_REASON_CHIPS, REVIEW_RELOAD_CODES, formatReviewedAt, reviewErrorText, reviewSuccessText, todayLocal } from "./monitor-rules";
import { sendAnomalyReview } from "./use-monitor-data";

/**
 * Tinjau anomali di detail catatan (B1): satu keputusan per catatan. Valid = absensi tetap; Tidak valid = status
 * jadi Alpa (jalur Koreksi) dan siswa diberi tahu. Flag yang tampil dikirim bersama keputusan agar flag baru yang
 * muncul selagi dialog terbuka tidak ikut tersetujui tanpa dilihat.
 */
interface PanelProps { readonly data: RecordDetailDto; readonly onReviewed: () => void; readonly onCorrect: () => void }

export function AnomalyReviewPanel({ data, onReviewed, onCorrect }: PanelProps) {
  const [editing, setEditing] = useState(false);
  if (!data.hasAnomaly) return null;
  const review = data.review;
  if (review && !(review.decision === "VALID" && editing)) return <ReviewedSummary data={data} onEdit={() => setEditing(true)} onCorrect={onCorrect} />;
  return <ReviewForm data={data} onlyInvalid={review?.decision === "VALID"} onReviewed={onReviewed} />;
}

function ReviewedSummary({ data, onEdit, onCorrect }: { data: RecordDetailDto; onEdit: () => void; onCorrect: () => void }) {
  const { me } = useHub();
  const review = data.review!;
  const head = [review.decision === "VALID" ? "Valid" : "Tidak valid", review.reviewer?.name, formatReviewedAt(review.reviewedAt, me.school?.timezone)].filter(Boolean).join(" · ");
  return <section className="monitor-review" aria-labelledby="monitor-review-title">
    <h3 id="monitor-review-title" className="monitor-subhead">Tinjauan</h3>
    <p className="monitor-review-line"><strong>{head}</strong>{review.decision === "VALID" && <button type="button" className="text-button" onClick={onEdit}>Ubah jadi tidak valid</button>}</p>
    {review.note && review.note !== data.note && <p className="muted">“{review.note}”</p>}
    {review.decision === "INVALID" && (data.status === "ALPHA"
      ? <p className="monitor-review-line">Perlu dipulihkan? Pakai Koreksi absensi.<button type="button" className="button secondary small-button" onClick={onCorrect}>Koreksi absensi</button></p>
      : <p className="muted">Status sudah dipulihkan lewat Koreksi absensi ({label(data.status)}).</p>)}
  </section>;
}

function ReviewForm({ data, onlyInvalid, onReviewed }: { data: RecordDetailDto; onlyInvalid: boolean; onReviewed: () => void }) {
  const { me, demo, schoolId, toast } = useHub();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const windowLimited = me.user.role !== "SUPER_ADMIN";
  const invalidBlocked = invalidBlockedByWindow({ date: data.date, today: todayLocal(new Date(), me.school?.timezone), windowLimited });
  async function decide(decision: ReviewDecision) {
    const problem = reviewNoteProblem(decision, note);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const result: AnomalyReviewResultDto = await sendAnomalyReview({ attendanceId: data.id, decision, note, flags: data.flags.map(f => f.code), demo, schoolId, reviewer: { id: me.user.id, name: me.user.name } });
      toast(reviewSuccessText(decision, result.statusChanged));
      onReviewed();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      const text = reviewErrorText(code, e instanceof Error ? e.message : "Tinjauan belum tersimpan.");
      // Keadaan catatan berubah: detail dimuat ulang (panel ikut dipasang ulang), jadi pesan dibawa lewat toast.
      if (REVIEW_RELOAD_CODES.has(code)) { toast(text); onReviewed(); } else setError(text);
    } finally { setBusy(false); }
  }
  return <section className="monitor-review" aria-labelledby="monitor-review-title">
    <h3 id="monitor-review-title" className="monitor-subhead">{onlyInvalid ? "Ubah tinjauan" : <span className="row-tag is-danger">Perlu ditinjau</span>}</h3>
    {demo && <p className="info-message">Mode demo: keputusan hanya tersimpan di peramban ini sampai halaman dimuat ulang.</p>}
    <label className="field" htmlFor={noteId}>Catatan peninjauan<textarea id={noteId} rows={2} maxLength={REVIEW_NOTE_MAX} value={note} onChange={e => setNote(e.target.value)} /><small className="field-hint">Wajib bila Tidak valid — dikirim ke siswa. {note.length}/{REVIEW_NOTE_MAX}</small></label>
    <div className="review-chips">{INVALID_REASON_CHIPS.map(chip => <button key={chip} type="button" className="review-chip" aria-pressed={note.includes(chip)} onClick={() => setNote(n => toggleQuickReason(n, chip))}>{chip}</button>)}</div>
    <div className="monitor-review-actions">
      {!onlyInvalid && <button type="button" className="button secondary small-button" disabled={busy} onClick={() => void decide("VALID")}>Valid</button>}
      {invalidBlocked ? <span className="muted">Lebih dari 45 hari — hanya super admin yang bisa menandai Tidak valid.</span>
        : <button type="button" className="button danger-outline small-button" disabled={busy} onClick={() => void decide("INVALID")}>{busy ? "Menyimpan…" : "Tidak valid"}</button>}
    </div>
    <p className="field-hint">{onlyInvalid ? "Tidak valid: status jadi Alpa dan siswa diberi tahu." : "Valid: absensi tetap. Tidak valid: status jadi Alpa dan siswa diberi tahu."}</p>
    {error && <p className="error-message" role="alert">{error}</p>}
  </section>;
}
