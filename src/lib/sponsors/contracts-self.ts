import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { MAX_PENDING_TOPUPS, TOPUP_MAX_BODY_BYTES, TOPUP_MAX_TRANSFER_AGE_DAYS } from "./constants";
import { ledgerEntrySchema, sponsorBalanceSchema, sponsorSchema, topUpSchema } from "./response-schemas";
import { ledgerQuery, ownTopUpsQuery, submitTopUpBody, topUpIdParams, updateOwnProfileBody } from "./schemas";

/** Kontrak sponsor (/sponsor/*): profil, kartu saldo, ledger, top-up. Data selalu milik sponsor pemanggil. */
const TAG = "Sponsor";
const UPLOAD_ERRORS = [
  "LENGTH_REQUIRED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "HEIC_NOT_SUPPORTED", "IMAGE_UNREADABLE", "IMAGE_TOO_LARGE", "SERVICE_UNAVAILABLE",
] as const;

export const getOwnSponsorProfileContract = defineContract({
  id: "getOwnSponsorProfile",
  method: "GET",
  path: "/api/v1/sponsor/profile",
  tag: TAG,
  summary: "Profil sponsor milik sendiri",
  action: "sponsor.self.read",
  response: sponsorSchema,
});

export const updateOwnSponsorProfileContract = defineContract({
  id: "updateOwnSponsorProfile",
  method: "PATCH",
  path: "/api/v1/sponsor/profile",
  tag: TAG,
  summary: "Ubah kontak sponsor (bukan SUSPENDED)",
  action: "sponsor.self.write",
  body: updateOwnProfileBody,
  response: sponsorSchema,
});

export const getOwnBalanceContract = defineContract({
  id: "getOwnSponsorBalance",
  method: "GET",
  path: "/api/v1/sponsor/balance",
  tag: TAG,
  summary: "Kartu saldo: \"sisa … dari total top-up\" + rekening tujuan top-up",
  action: "sponsor.self.read",
  response: sponsorBalanceSchema,
});

export const listOwnLedgerContract = defineContract({
  id: "listOwnSponsorLedger",
  method: "GET",
  path: "/api/v1/sponsor/ledger",
  tag: TAG,
  summary: "Mutasi saldo (ledger) terbaru dulu",
  action: "sponsor.self.read",
  query: ledgerQuery,
  response: z.array(ledgerEntrySchema),
  pagination: "page",
});

export const listOwnTopUpsContract = defineContract({
  id: "listOwnTopUps",
  method: "GET",
  path: "/api/v1/sponsor/topups",
  tag: TAG,
  summary: "Riwayat pengajuan top-up",
  action: "sponsor.self.read",
  query: ownTopUpsQuery,
  response: z.array(topUpSchema),
  pagination: "page",
});

export const submitTopUpContract = defineContract({
  id: "submitTopUp",
  method: "POST",
  path: "/api/v1/sponsor/topups",
  tag: TAG,
  summary: "Ajukan top-up dengan foto bukti transfer (multipart, hanya APPROVED)",
  description: `Nominal >= minimal top-up platform, transferDate hari ini - ${TOPUP_MAX_TRANSFER_AGE_DAYS} .. hari ini (WIB), maks ${MAX_PENDING_TOPUPS} pengajuan menunggu (409 TOPUP_LIMIT). Foto di-encode ulang tanpa EXIF, disimpan privat. Super admin menerima TOPUP_SUBMITTED.`,
  action: "sponsor.topup",
  body: submitTopUpBody,
  bodyType: "multipart",
  maxBodyBytes: TOPUP_MAX_BODY_BYTES,
  response: topUpSchema,
  successStatus: 201,
  rateLimit: { limiter: "UPLOAD", key: "user" },
  errors: ["TOPUP_LIMIT", "TOPUP_AMOUNT_INVALID", "TRANSFER_DATE_OUT_OF_RANGE", "SPONSOR_NOT_APPROVED", "SPONSOR_SUSPENDED", ...UPLOAD_ERRORS, "RATE_LIMITED"],
});

export const cancelOwnTopUpContract = defineContract({
  id: "cancelOwnTopUp",
  method: "POST",
  path: "/api/v1/sponsor/topups/{id}/cancel",
  tag: TAG,
  summary: "Batalkan top-up yang masih menunggu",
  description: "Hanya milik sendiri berstatus PENDING (409 TOPUP_ALREADY_REVIEWED). Top-up sponsor lain -> 404.",
  action: "sponsor.self.write",
  params: topUpIdParams,
  response: topUpSchema,
  errors: ["TOPUP_NOT_FOUND", "TOPUP_ALREADY_REVIEWED"],
});

export const sponsorSelfContracts: readonly AnyContract[] = [
  getOwnSponsorProfileContract, updateOwnSponsorProfileContract, getOwnBalanceContract, listOwnLedgerContract,
  listOwnTopUpsContract, submitTopUpContract, cancelOwnTopUpContract,
];
