import { z } from "zod";
import { dateOutSchema } from "@/lib/academics/schema-common";
import { LEDGER_TYPES, SPONSOR_STATUSES, TOPUP_STATUSES } from "./constants";

/** Skema respons domain sponsor (OpenAPI + validasi respons di mode test). Uang = rupiah bulat. */

const dateTime = z.string().meta({ format: "date-time" });
const money = z.int();

export const sponsorSchema = z
  .object({
    id: z.string(),
    companyName: z.string(),
    contactName: z.string(),
    contactEmail: z.string(),
    contactPhone: z.string(),
    address: z.string().nullable(),
    status: z.enum(SPONSOR_STATUSES),
    statusReason: z.string().nullable(),
    reviewedAt: dateTime.nullable(),
    balance: money.meta({ description: "Saldo PPC (cache ledger; selalu = balanceAfter entri terakhir)." }),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .meta({ id: "Sponsor" });
export type SponsorDto = z.input<typeof sponsorSchema>;

export const sponsorListItemSchema = z
  .object({
    id: z.string(),
    companyName: z.string(),
    contactEmail: z.string(),
    status: z.enum(SPONSOR_STATUSES),
    balance: money,
    pendingTopUps: z.int(),
    pendingAdReviews: z.int(),
    createdAt: dateTime,
  })
  .meta({ id: "SponsorListItem" });
export type SponsorListItemDto = z.input<typeof sponsorListItemSchema>;

export const balanceSummarySchema = z
  .object({
    balance: money,
    totalTopUp: money.meta({ description: "Total top-up disetujui sepanjang waktu (\"sisa <balance> dari total <totalTopUp>\")." }),
    totalSpent: money.meta({ description: "Total biaya klik yang ditagih." }),
    netAdjustment: money.meta({ description: "Jumlah bersih penyesuaian super admin (bertanda)." }),
    estimatedClicksRemaining: z.int().meta({ description: "floor(saldo / CPC default saat ini)." }),
  })
  .meta({ id: "SponsorBalanceSummary" });

export const sponsorMemberSchema = z
  .object({ id: z.string(), name: z.string(), email: z.string().nullable(), isActive: z.boolean(), mustChangePassword: z.boolean() })
  .meta({ id: "SponsorMember" });

export const sponsorDetailSchema = sponsorSchema
  .extend({ members: z.array(sponsorMemberSchema), balanceSummary: balanceSummarySchema, pendingTopUps: z.int() })
  .meta({ id: "SponsorDetail" });
export type SponsorDetailDto = z.input<typeof sponsorDetailSchema>;

export const createSponsorResultSchema = z
  .object({
    sponsor: sponsorSchema,
    userId: z.string(),
    temporaryPassword: z.string().optional().meta({ description: "Hanya bila kata sandi di-generate; ditampilkan SEKALI." }),
  })
  .meta({ id: "CreateSponsorResult" });

export const topUpAccountSchema = z
  .object({ bankName: z.string(), accountNumber: z.string(), accountHolder: z.string() })
  .meta({ id: "TopUpAccount" });

export const sponsorBalanceSchema = balanceSummarySchema
  .extend({
    lowBalanceThreshold: money,
    defaultCpcAmount: money,
    minTopUpAmount: money,
    pendingTopUps: z.int(),
    topUpAccount: topUpAccountSchema.nullable().meta({ description: "Rekening tujuan top-up; null bila belum diatur super admin." }),
  })
  .meta({ id: "SponsorBalance" });
export type SponsorBalanceDto = z.input<typeof sponsorBalanceSchema>;

export const ledgerEntrySchema = z
  .object({
    id: z.string(),
    seq: z.int(),
    type: z.enum(LEDGER_TYPES),
    amount: money.meta({ description: "Bertanda: + kredit, - debit." }),
    balanceAfter: money,
    note: z.string().nullable(),
    topUpRequestId: z.string().nullable(),
    adId: z.string().nullable().meta({ description: "Iklan yang diklik (entri CLICK_CHARGE)." }),
    createdAt: dateTime,
  })
  .meta({ id: "LedgerEntry" });
export type LedgerEntryDto = z.input<typeof ledgerEntrySchema>;

export const topUpSchema = z
  .object({
    id: z.string(),
    sponsorId: z.string(),
    amount: money,
    transferDate: dateOutSchema,
    senderName: z.string(),
    senderBank: z.string(),
    note: z.string().nullable(),
    status: z.enum(TOPUP_STATUSES),
    reviewNote: z.string().nullable(),
    reviewedAt: dateTime.nullable(),
    proofFileId: z.string().meta({ description: "Unduh lewat GET /api/v1/files/{id} (pemilik & super admin)." }),
    createdAt: dateTime,
  })
  .meta({ id: "TopUpRequest" });
export type TopUpDto = z.input<typeof topUpSchema>;

export const platformTopUpSchema = topUpSchema
  .extend({
    sponsor: z.object({ id: z.string(), companyName: z.string(), status: z.enum(SPONSOR_STATUSES), balance: money }),
    duplicateProofOf: z.array(z.string()).meta({ description: "Id top-up lain (sponsor mana pun) dengan bukti identik (sha256). Penanda saja." }),
  })
  .meta({ id: "PlatformTopUpRequest" });
export type PlatformTopUpDto = z.input<typeof platformTopUpSchema>;

export const approveTopUpResultSchema = z
  .object({ topUp: platformTopUpSchema, ledgerEntry: ledgerEntrySchema })
  .meta({ id: "ApproveTopUpResult" });

export const adSettingsSchema = z
  .object({
    defaultCpcAmount: money,
    minTopUpAmount: money,
    topUpBankName: z.string().nullable(),
    topUpAccountNumber: z.string().nullable(),
    topUpAccountHolder: z.string().nullable(),
    deepLinkSchemes: z.array(z.string()),
    lowBalanceThreshold: money,
    updatedAt: dateTime,
  })
  .meta({ id: "AdSettings" });
export type AdSettingsDto = z.input<typeof adSettingsSchema>;
