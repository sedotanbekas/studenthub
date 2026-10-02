import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { loginEventSchema, loginHistoryQuery } from "./schemas";

export const listLoginHistoryContract = defineContract({
  id: "listLoginHistory",
  method: "GET",
  path: "/api/v1/platform/login-history",
  tag: "Log Audit",
  summary: "Riwayat masuk super admin (terbaru dulu)",
  description: [
    "Setiap login berhasil dan percobaan gagal (kata sandi salah dsb.) ke akun super admin: perangkat & browser, IP,",
    "perkiraan lokasi + ISP dari IP (DB-IP Lite, bukan GPS — wajib atribusi \"IP Geolocation by DB-IP\"), dan penanda",
    "perangkat baru. Pembeda pemakai akun sejak TOTP super admin dimatikan (2026-10-02).",
  ].join(" "),
  action: "audit.login.read",
  query: loginHistoryQuery,
  response: z.array(loginEventSchema),
  pagination: "page",
});

export const loginHistoryContracts: readonly AnyContract[] = [listLoginHistoryContract];
