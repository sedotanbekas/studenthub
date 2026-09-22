import { z } from "zod";
import { entityIdSchema, localDateSchema } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  ADDRESS_MAX, ADJUSTMENT_MAX_ABS, COMPANY_NAME_MAX, COMPANY_NAME_MIN, CONTACT_NAME_MAX, CPC_MAX, CPC_MIN, LEDGER_TYPES,
  MAX_DEEP_LINK_SCHEMES, NOTE_MAX, NOTE_MIN, PHONE_MAX, SEARCH_MAX, SENDER_BANK_MAX, SENDER_NAME_MAX, SPONSOR_STATUSES,
  TOPUP_MAX, TOPUP_MIN_FLOOR, TOPUP_STATUSES,
} from "./constants";

/** Skema zod input domain sponsor (validasi runtime + OpenAPI). Teks dirapikan (trim + spasi ganda jadi satu). */

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();

const cleanText = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().min(min, `${label} minimal ${min} karakter.`).max(max, `${label} maksimal ${max} karakter.`))
    .meta({ minLength: min, maxLength: max });

/** Teks opsional bisa dikosongkan: "" / null -> null. */
const nullableText = (max: number, label: string) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().max(max, `${label} maksimal ${max} karakter.`))
    .transform((value) => (value === "" ? null : value))
    .meta({ maxLength: max })
    .nullable();

const emailSchema = z.string().trim().toLowerCase().max(191).pipe(z.email("Format email tidak valid."));
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,18}$/, "Nomor telepon tidak valid.")
  .max(PHONE_MAX)
  .meta({ example: "+6281234567890" });
const companyName = cleanText(COMPANY_NAME_MIN, COMPANY_NAME_MAX, "Nama perusahaan");
const contactName = cleanText(3, CONTACT_NAME_MAX, "Nama kontak");
const hasAnyField = (value: Record<string, unknown>): boolean => Object.values(value).some((v) => v !== undefined);
const EMPTY_PATCH = "Minimal satu field harus diubah.";

export const sponsorIdParams = z.object({ id: entityIdSchema.meta({ description: "Id sponsor." }) });
export const topUpIdParams = z.object({ id: entityIdSchema.meta({ description: "Id pengajuan top-up." }) });

export const noteSchema = cleanText(NOTE_MIN, NOTE_MAX, "Catatan");
export const reasonBody = z.strictObject({ reason: cleanText(NOTE_MIN, NOTE_MAX, "Alasan") }).meta({ id: "SponsorReasonInput" });
export type ReasonInput = z.output<typeof reasonBody>;

// ----------------------------------------------------------------------------- akun sponsor (super admin)

export const createSponsorBody = z
  .strictObject({
    companyName,
    contactName,
    contactEmail: emailSchema,
    contactPhone: phoneSchema,
    address: nullableText(ADDRESS_MAX, "Alamat").optional(),
    login: z.strictObject({
      name: cleanText(3, 100, "Nama pengguna"),
      email: emailSchema.meta({ description: "Email login akun SPONSOR (unik)." }),
      initialPassword: z.string().min(1).max(200).optional().meta({ description: "Opsional; bila kosong sistem membuat kata sandi sementara (14 hari, ditampilkan sekali)." }),
    }),
  })
  .meta({ id: "CreateSponsorInput" });
export type CreateSponsorInput = z.output<typeof createSponsorBody>;

export const updateSponsorBody = z
  .strictObject({
    companyName: companyName.optional(),
    contactName: contactName.optional(),
    contactEmail: emailSchema.optional(),
    contactPhone: phoneSchema.optional(),
    address: nullableText(ADDRESS_MAX, "Alamat").optional(),
  })
  .refine(hasAnyField, EMPTY_PATCH)
  .meta({ id: "UpdateSponsorInput" });
export type UpdateSponsorInput = z.output<typeof updateSponsorBody>;

export const updateOwnProfileBody = z
  .strictObject({
    contactName: contactName.optional(),
    contactPhone: phoneSchema.optional(),
    address: nullableText(ADDRESS_MAX, "Alamat").optional(),
  })
  .refine(hasAnyField, EMPTY_PATCH)
  .meta({ id: "UpdateSponsorProfileInput", description: "Nama perusahaan & email kontak hanya diubah super admin." });
export type UpdateOwnProfileInput = z.output<typeof updateOwnProfileBody>;

export const listSponsorsQuery = pageQuerySchema.extend({
  status: z.enum(SPONSOR_STATUSES).optional(),
  q: z.string().trim().min(1).max(SEARCH_MAX).optional().meta({ description: "Cari nama perusahaan atau email kontak." }),
});
export type ListSponsorsQuery = z.output<typeof listSponsorsQuery>;

// ----------------------------------------------------------------------------- ledger

export const ledgerQuery = pageQuerySchema.extend({ type: z.enum(LEDGER_TYPES).optional() });
export type LedgerQuery = z.output<typeof ledgerQuery>;

export const adjustmentBody = z
  .strictObject({
    amount: z
      .int("Nominal harus bilangan bulat rupiah.")
      .min(-ADJUSTMENT_MAX_ABS)
      .max(ADJUSTMENT_MAX_ABS)
      .refine((value) => value !== 0, "Nominal penyesuaian tidak boleh 0.")
      .meta({ description: "Bertanda: + kredit (mis. klik tidak sah dikembalikan), - debit. Saldo tidak boleh negatif (422 INSUFFICIENT_BALANCE).", example: 5000 }),
    note: noteSchema.meta({ description: "Alasan penyesuaian (wajib, diaudit)." }),
  })
  .meta({ id: "LedgerAdjustmentInput" });
export type AdjustmentInput = z.output<typeof adjustmentBody>;

// ----------------------------------------------------------------------------- top-up

export const submitTopUpBody = z
  .strictObject({
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,9}$/, "Nominal harus bilangan bulat rupiah tanpa pemisah.")
      .transform(Number)
      .pipe(z.int().min(1).max(TOPUP_MAX))
      .meta({ description: `Nominal transfer (>= minimal top-up platform, >= ${TOPUP_MIN_FLOOR}; <= ${TOPUP_MAX}).`, example: "250000" }),
    transferDate: localDateSchema.meta({ description: "Tanggal transfer (WIB), hari ini - 30 .. hari ini." }),
    senderName: cleanText(2, SENDER_NAME_MAX, "Nama pengirim"),
    senderBank: cleanText(2, SENDER_BANK_MAX, "Bank pengirim"),
    note: nullableText(NOTE_MAX, "Catatan").optional(),
    file: z.file().min(1, "Foto bukti transfer wajib diisi.").meta({ description: "Foto bukti transfer JPEG/PNG/WebP (maks 8 MiB). Di-encode ulang tanpa EXIF, disimpan privat." }),
  })
  .meta({ id: "SubmitTopUpInput" });
export type SubmitTopUpInput = z.output<typeof submitTopUpBody>;

export const ownTopUpsQuery = pageQuerySchema.extend({ status: z.enum(TOPUP_STATUSES).optional() });
export type OwnTopUpsQuery = z.output<typeof ownTopUpsQuery>;

export const platformTopUpsQuery = pageQuerySchema.extend({
  status: z.enum(TOPUP_STATUSES).default("PENDING").meta({ description: "Default PENDING (antrean, terlama dulu)." }),
  sponsorId: entityIdSchema.optional(),
});
export type PlatformTopUpsQuery = z.output<typeof platformTopUpsQuery>;

// ----------------------------------------------------------------------------- pengaturan platform iklan

const moneySetting = (min: number, max: number) => z.int("Harus bilangan bulat rupiah.").min(min).max(max);

export const updateAdSettingsBody = z
  .strictObject({
    defaultCpcAmount: moneySetting(CPC_MIN, CPC_MAX).optional().meta({ description: "Tidak mengubah CPC iklan yang sudah diajukan (snapshot saat submit)." }),
    minTopUpAmount: moneySetting(TOPUP_MIN_FLOOR, TOPUP_MAX).optional(),
    topUpBankName: nullableText(50, "Nama bank").optional(),
    topUpAccountNumber: z.string().trim().regex(/^[0-9 -]{5,30}$/, "Nomor rekening tidak valid.").nullable().optional(),
    topUpAccountHolder: nullableText(100, "Nama pemilik rekening").optional(),
    deepLinkSchemes: z
      .array(z.string().trim().toLowerCase().min(1).max(32))
      .max(MAX_DEEP_LINK_SCHEMES)
      .optional()
      .meta({ description: "Skema aplikasi pihak ketiga untuk iklan DEEP_LINK, mis. [\"shopee\"]. Skema berbahaya (javascript, data, intent, http, https, ...) ditolak 422 SETTINGS_INVALID." }),
  })
  .refine(hasAnyField, EMPTY_PATCH)
  .meta({ id: "UpdateAdSettingsInput" });
export type UpdateAdSettingsInput = z.output<typeof updateAdSettingsBody>;
