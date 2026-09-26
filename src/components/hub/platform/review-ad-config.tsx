"use client";
import type { ReviewAdDto } from "@/lib/frontend/ad-types";
import { api, ApiError } from "@/lib/frontend/api";
import { rupiah } from "@/lib/frontend/format";
import { reachSummary, reviewFailure, scheduleInfo, wibDateTime } from "@/lib/frontend/review-rules";
import type { AdDecision } from "./review-ad-detail";
import type { DecisionConfig, ReasonConfig } from "./review-decision-dialog";

/** Teks dialog, badan permintaan, dan hasil lokal tiap keputusan moderasi iklan. */

const AD_REASON: Omit<ReasonConfig, "label"> = {
  chips: ["Konten tidak sesuai untuk pelajar", "Klaim tidak dapat diverifikasi", "Tautan tujuan tidak sesuai", "Kualitas banner kurang jelas"],
  hint: "5–255 karakter. Tulis singkat apa yang perlu diperbaiki sponsor.",
  placeholder: "Contoh: Banner menjanjikan “pasti lulus” tanpa bukti. Mohon ganti klaimnya.",
};

export function adDecisionConfig(kind: AdDecision, ad: ReviewAdDto, now: Date): DecisionConfig {
  if (kind === "approve") {
    const schedule = scheduleInfo(ad.startAt, ad.endAt, now);
    const when = schedule.state === "upcoming" ? `mulai ${wibDateTime(ad.startAt)}` : "segera setelah disetujui";
    return {
      eyebrow: "Moderasi iklan", title: "Setujui iklan ini?", confirmLabel: "Ya, setujui", tone: "primary",
      intro: <p>“{ad.title}” dari <strong>{ad.sponsor.companyName}</strong> akan tampil di beranda siswa ({reachSummary(ad.targetScope, ad.targets.map(t => t.label))}) {when}. Setiap klik sah memotong {rupiah(ad.cpcAmount)} dari saldo sponsor.</p>,
    };
  }
  if (kind === "reject") {
    return {
      eyebrow: "Moderasi iklan", title: "Tolak iklan", confirmLabel: "Tolak iklan", tone: "danger",
      intro: <p>Sponsor menerima alasan ini lewat notifikasi, lalu dapat memperbaiki dan mengajukan ulang.</p>,
      reason: { ...AD_REASON, label: "Alasan untuk sponsor" },
    };
  }
  return {
    eyebrow: "Moderasi iklan", title: "Turunkan iklan", confirmLabel: "Turunkan iklan", tone: "danger",
    intro: <p>“{ad.title}” berhenti tayang untuk semua siswa seketika dan berstatus <strong>Ditolak</strong>. Sponsor menerima alasan ini.</p>,
    reason: { ...AD_REASON, label: "Alasan penurunan" },
  };
}

/** Status & catatan setelah keputusan (dipakai untuk memindahkan item antar-tab secara lokal). */
export function adPatch(kind: AdDecision, reason: string): Partial<ReviewAdDto> {
  return kind === "approve" ? { status: "APPROVED", reviewNote: null } : { status: "REJECTED", reviewNote: reason };
}

export const AD_DONE: Record<AdDecision, { readonly live: string; readonly demo: string }> = {
  approve: { live: "Iklan disetujui dan tayang untuk siswa sesuai jadwal.", demo: "Mode demo: iklan disetujui dan pindah ke tab Disetujui." },
  reject: { live: "Iklan ditolak. Sponsor menerima alasanmu lewat notifikasi.", demo: "Mode demo: iklan ditolak; di akun asli sponsor menerima alasanmu." },
  takedown: { live: "Iklan diturunkan dan berhenti tayang.", demo: "Mode demo: iklan diturunkan dan pindah ke tab Ditolak." },
};

/**
 * Penjelasan saat keputusan ditolak karena status iklan sudah berubah (AD_INVALID_TRANSITION):
 * item biasanya hilang dari antrean setelah dimuat ulang, jadi disampaikan lewat toast.
 */
export const AD_GONE: Record<AdDecision, string> = {
  approve: "Iklan ini sudah tidak menunggu tinjauan — mungkin ditarik sponsor atau sudah diputus admin lain. Antrean dimuat ulang.",
  reject: "Iklan ini sudah tidak menunggu tinjauan — mungkin ditarik sponsor atau sudah diputus admin lain. Antrean dimuat ulang.",
  takedown: "Iklan ini sudah tidak tayang maupun dijeda — mungkin sudah diturunkan admin lain atau diarsipkan sponsor. Daftar dimuat ulang.",
};

/** Keputusan tidak diterapkan karena data berubah: `code` galat server + teks siap tampil. */
export interface AdConflict { readonly code: string; readonly text: string }

/**
 * Kirim keputusan. `submittedAt` disalin persis dari detail (token CAS). Hasil: null = berhasil;
 * konflik = data sudah berubah (muat ulang lalu jelaskan). Galat lain dilempar ke dialog.
 */
export async function submitAdDecision(kind: AdDecision, ad: ReviewAdDto, reason: string): Promise<AdConflict | null> {
  const body = kind === "approve" ? { submittedAt: ad.submittedAt } : kind === "reject" ? { submittedAt: ad.submittedAt, reason } : { reason };
  try {
    await api(`/platform/ads/${encodeURIComponent(ad.id)}/${kind}`, { method: "POST", body: JSON.stringify(body) });
    return null;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const failure = reviewFailure(error.code);
    const text = [error.message, failure.hint].filter(Boolean).join(" ");
    if (failure.reload) return { code: error.code, text };
    throw new ApiError(text, error.code, error.details);
  }
}
