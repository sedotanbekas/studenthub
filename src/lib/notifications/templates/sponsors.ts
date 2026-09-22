import { formatRupiah } from "@/lib/billing/format";
import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi sponsor & iklan (murni, Bahasa Indonesia). Tautan dashboard: { screen: "sponsor", id }
 * untuk akun/saldo, { screen: "ad", id } / { screen: "ad-review", id } untuk iklan,
 * { screen: "topup", id } / { screen: "topup-review", id } untuk top-up.
 */

export function sponsorApprovedNotification(info: { sponsorId: string; reactivated: boolean }): NotificationEvent {
  return {
    type: "SPONSOR_APPROVED",
    title: info.reactivated ? "Akun sponsor aktif kembali" : "Akun sponsor disetujui",
    body: info.reactivated
      ? "Akun sponsor Anda telah diaktifkan kembali. Iklan yang disetujui dapat tayang lagi."
      : "Akun sponsor Anda telah disetujui. Anda sekarang dapat mengajukan iklan dan top-up saldo.",
    link: { screen: "sponsor", id: info.sponsorId },
  };
}

export function sponsorSuspendedNotification(info: { sponsorId: string; reason: string }): NotificationEvent {
  return {
    type: "SPONSOR_SUSPENDED",
    title: "Akun sponsor ditangguhkan",
    body: `Akun sponsor Anda ditangguhkan; iklan berhenti tayang dan akun hanya dapat dibaca. Alasan: ${info.reason}`,
    link: { screen: "sponsor", id: info.sponsorId },
  };
}

export function adSubmittedNotification(info: { adId: string; title: string; companyName: string }): NotificationEvent {
  return {
    type: "AD_SUBMITTED",
    title: "Iklan baru menunggu review",
    body: `${info.companyName} mengajukan iklan "${info.title}". Tinjau sebelum tayang.`,
    link: { screen: "ad-review", id: info.adId },
  };
}

export function adApprovedNotification(info: { adId: string; title: string }): NotificationEvent {
  return {
    type: "AD_APPROVED",
    title: "Iklan disetujui",
    body: `Iklan "${info.title}" disetujui dan akan tayang sesuai jadwal selama saldo mencukupi.`,
    link: { screen: "ad", id: info.adId },
  };
}

export function adRejectedNotification(info: { adId: string; title: string; reason: string; takedown: boolean }): NotificationEvent {
  return {
    type: "AD_REJECTED",
    title: info.takedown ? "Iklan diturunkan" : "Iklan ditolak",
    body: `Iklan "${info.title}" ${info.takedown ? "diturunkan oleh admin" : "ditolak"}. Alasan: ${info.reason}`,
    link: { screen: "ad", id: info.adId },
  };
}

export function topUpSubmittedNotification(info: { topUpId: string; companyName: string; amount: number }): NotificationEvent {
  return {
    type: "TOPUP_SUBMITTED",
    title: "Top-up saldo menunggu verifikasi",
    body: `${info.companyName} mengajukan top-up ${formatRupiah(info.amount)}. Periksa bukti transfer.`,
    link: { screen: "topup-review", id: info.topUpId },
  };
}

export function topUpApprovedNotification(info: { topUpId: string; amount: number; balance: number }): NotificationEvent {
  return {
    type: "TOPUP_APPROVED",
    title: "Top-up disetujui",
    body: `Top-up ${formatRupiah(info.amount)} telah masuk. Saldo sekarang ${formatRupiah(info.balance)}.`,
    link: { screen: "topup", id: info.topUpId },
  };
}

export function topUpRejectedNotification(info: { topUpId: string; amount: number; reason: string }): NotificationEvent {
  return {
    type: "TOPUP_REJECTED",
    title: "Top-up ditolak",
    body: `Top-up ${formatRupiah(info.amount)} ditolak. Alasan: ${info.reason}`,
    link: { screen: "topup", id: info.topUpId },
  };
}

export function lowBalanceNotification(info: { sponsorId: string; level: "LOW" | "EXHAUSTED"; balance: number }): NotificationEvent {
  const exhausted = info.level === "EXHAUSTED";
  return {
    type: "LOW_BALANCE",
    title: exhausted ? "Saldo iklan habis" : "Saldo iklan menipis",
    body: exhausted
      ? `Saldo Anda ${formatRupiah(info.balance)} tidak cukup untuk biaya klik; iklan berhenti tayang. Lakukan top-up.`
      : `Saldo Anda tinggal ${formatRupiah(info.balance)}. Lakukan top-up agar iklan tetap tayang.`,
    link: { screen: "sponsor", id: info.sponsorId },
  };
}
