import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { NOTE_MAX, NOTE_MIN } from "./constants";
import {
  adSettingsSchema,
  approveTopUpResultSchema,
  createSponsorResultSchema,
  ledgerEntrySchema,
  platformTopUpSchema,
  sponsorDetailSchema,
  sponsorListItemSchema,
  sponsorSchema,
} from "./response-schemas";
import {
  adjustmentBody,
  createSponsorBody,
  ledgerQuery,
  listSponsorsQuery,
  platformTopUpsQuery,
  reasonBody,
  sponsorIdParams,
  topUpIdParams,
  updateAdSettingsBody,
  updateSponsorBody,
} from "./schemas";

/** Kontrak super admin: akun sponsor, ledger & penyesuaian, verifikasi top-up, pengaturan platform iklan. */
const TAG = "Sponsor — Platform";

export const createSponsorContract = defineContract({
  id: "createSponsor",
  method: "POST",
  path: "/api/v1/platform/sponsors",
  tag: TAG,
  summary: "Buat akun sponsor + login pertama (status PENDING)",
  description: "Sponsor PENDING bersaldo 0 dan satu akun SPONSOR yang wajib ganti kata sandi. Tanpa initialPassword -> kata sandi sementara 14 hari dikembalikan SEKALI. Email login terpakai -> 409 EMAIL_TAKEN.",
  action: "sponsor.admin",
  body: createSponsorBody,
  response: createSponsorResultSchema,
  successStatus: 201,
  errors: ["EMAIL_TAKEN", "PASSWORD_POLICY"],
});

export const listSponsorsContract = defineContract({
  id: "listSponsors",
  method: "GET",
  path: "/api/v1/platform/sponsors",
  tag: TAG,
  summary: "Daftar sponsor (filter status, cari nama/email)",
  action: "sponsor.admin",
  query: listSponsorsQuery,
  response: z.array(sponsorListItemSchema),
  pagination: "page",
});

export const getSponsorContract = defineContract({
  id: "getSponsor",
  method: "GET",
  path: "/api/v1/platform/sponsors/{id}",
  tag: TAG,
  summary: "Detail sponsor + anggota + ringkasan saldo",
  action: "sponsor.admin",
  params: sponsorIdParams,
  response: sponsorDetailSchema,
  errors: ["SPONSOR_NOT_FOUND"],
});

export const updateSponsorContract = defineContract({
  id: "updateSponsor",
  method: "PATCH",
  path: "/api/v1/platform/sponsors/{id}",
  tag: TAG,
  summary: "Ubah data perusahaan & kontak sponsor",
  description: "Diaudit. Status diubah lewat endpoint approve/suspend/reactivate.",
  action: "sponsor.admin",
  params: sponsorIdParams,
  body: updateSponsorBody,
  response: sponsorSchema,
  errors: ["SPONSOR_NOT_FOUND"],
});

const TRANSITION_ERRORS = ["SPONSOR_NOT_FOUND", "SPONSOR_INVALID_TRANSITION"] as const;
const TRANSITION_NOTE = "Transisi tidak sah -> 409 SPONSOR_INVALID_TRANSITION. Anggota sponsor diberi notifikasi; diaudit.";

export const approveSponsorContract = defineContract({
  id: "approveSponsor",
  method: "POST",
  path: "/api/v1/platform/sponsors/{id}/approve",
  tag: TAG,
  summary: "Setujui sponsor (PENDING -> APPROVED)",
  description: `Sponsor dapat mengajukan iklan & top-up. ${TRANSITION_NOTE}`,
  action: "sponsor.admin",
  params: sponsorIdParams,
  response: sponsorSchema,
  errors: TRANSITION_ERRORS,
});

export const suspendSponsorContract = defineContract({
  id: "suspendSponsor",
  method: "POST",
  path: "/api/v1/platform/sponsors/{id}/suspend",
  tag: TAG,
  summary: "Tangguhkan sponsor (PENDING/APPROVED -> SUSPENDED)",
  description: `Alasan wajib (${NOTE_MIN}-${NOTE_MAX} karakter). Iklan berhenti tayang & klik tidak ditagih; akun hanya-baca. Baris iklan tidak diubah. ${TRANSITION_NOTE}`,
  action: "sponsor.admin",
  params: sponsorIdParams,
  body: reasonBody,
  response: sponsorSchema,
  errors: TRANSITION_ERRORS,
});

export const reactivateSponsorContract = defineContract({
  id: "reactivateSponsor",
  method: "POST",
  path: "/api/v1/platform/sponsors/{id}/reactivate",
  tag: TAG,
  summary: "Aktifkan kembali sponsor (SUSPENDED -> APPROVED)",
  description: `Iklan yang disetujui dapat tayang lagi tanpa review ulang. ${TRANSITION_NOTE}`,
  action: "sponsor.admin",
  params: sponsorIdParams,
  response: sponsorSchema,
  errors: TRANSITION_ERRORS,
});

export const platformLedgerContract = defineContract({
  id: "listSponsorLedgerPlatform",
  method: "GET",
  path: "/api/v1/platform/sponsors/{id}/ledger",
  tag: TAG,
  summary: "Ledger saldo sponsor (terbaru dulu)",
  action: "sponsor.admin",
  params: sponsorIdParams,
  query: ledgerQuery,
  response: z.array(ledgerEntrySchema),
  pagination: "page",
  errors: ["SPONSOR_NOT_FOUND"],
});

export const adjustLedgerContract = defineContract({
  id: "adjustSponsorBalance",
  method: "POST",
  path: "/api/v1/platform/sponsors/{id}/ledger-adjustments",
  tag: TAG,
  summary: "Penyesuaian saldo (ADJUSTMENT) dengan catatan",
  description: "Nominal bertanda (≠ 0, |x| <= 100.000.000), catatan wajib, diaudit. Saldo hasil < 0 -> 422 INSUFFICIENT_BALANCE (tanpa entri).",
  action: "sponsor.admin",
  params: sponsorIdParams,
  body: adjustmentBody,
  response: ledgerEntrySchema,
  successStatus: 201,
  errors: ["SPONSOR_NOT_FOUND", "INSUFFICIENT_BALANCE", "LEDGER_AMOUNT_INVALID", "CONFLICT_RETRY"],
});

export const listPlatformTopUpsContract = defineContract({
  id: "listPlatformTopUps",
  method: "GET",
  path: "/api/v1/platform/topups",
  tag: TAG,
  summary: "Antrean top-up (default PENDING, terlama dulu)",
  description: "duplicateProofOf = top-up lain dengan foto bukti identik (penanda, bukan penolakan otomatis).",
  action: "topup.review",
  query: platformTopUpsQuery,
  response: z.array(platformTopUpSchema),
  pagination: "page",
});

export const getPlatformTopUpContract = defineContract({
  id: "getPlatformTopUp",
  method: "GET",
  path: "/api/v1/platform/topups/{id}",
  tag: TAG,
  summary: "Detail top-up",
  action: "topup.review",
  params: topUpIdParams,
  response: platformTopUpSchema,
  errors: ["TOPUP_NOT_FOUND"],
});

export const approveTopUpContract = defineContract({
  id: "approveTopUp",
  method: "POST",
  path: "/api/v1/platform/topups/{id}/approve",
  tag: TAG,
  summary: "Setujui top-up (kredit saldo + entri ledger TOPUP)",
  description: "Compare-and-set PENDING -> APPROVED di bawah kunci baris Sponsor; persetujuan ganda/bersamaan -> tepat satu berhasil, lainnya 409 TOPUP_ALREADY_REVIEWED. Nominal dikreditkan persis; salah nominal = tolak lalu sponsor ajukan ulang.",
  action: "topup.review",
  params: topUpIdParams,
  response: approveTopUpResultSchema,
  errors: ["TOPUP_NOT_FOUND", "TOPUP_ALREADY_REVIEWED", "CONFLICT_RETRY"],
});

export const rejectTopUpContract = defineContract({
  id: "rejectTopUp",
  method: "POST",
  path: "/api/v1/platform/topups/{id}/reject",
  tag: TAG,
  summary: "Tolak top-up (alasan wajib)",
  action: "topup.review",
  params: topUpIdParams,
  body: reasonBody,
  response: platformTopUpSchema,
  errors: ["TOPUP_NOT_FOUND", "TOPUP_ALREADY_REVIEWED"],
});

export const getAdSettingsContract = defineContract({
  id: "getAdSettings",
  method: "GET",
  path: "/api/v1/platform/settings/ads",
  tag: TAG,
  summary: "Pengaturan platform iklan (CPC default, minimal top-up, rekening top-up, skema deep link)",
  action: "sponsor.admin",
  response: adSettingsSchema,
});

export const updateAdSettingsContract = defineContract({
  id: "updateAdSettings",
  method: "PATCH",
  path: "/api/v1/platform/settings/ads",
  tag: TAG,
  summary: "Ubah pengaturan platform iklan",
  description: "Diaudit. CPC default baru hanya berlaku untuk pengajuan iklan berikutnya (CPC di-snapshot saat submit).",
  action: "sponsor.admin",
  body: updateAdSettingsBody,
  response: adSettingsSchema,
  errors: ["SETTINGS_INVALID"],
});

export const sponsorPlatformContracts: readonly AnyContract[] = [
  createSponsorContract, listSponsorsContract, getSponsorContract, updateSponsorContract,
  approveSponsorContract, suspendSponsorContract, reactivateSponsorContract,
  platformLedgerContract, adjustLedgerContract,
  listPlatformTopUpsContract, getPlatformTopUpContract, approveTopUpContract, rejectTopUpContract,
  getAdSettingsContract, updateAdSettingsContract,
];
