import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { loginEventSchema, loginHistoryQuery } from "./schemas";

export const listLoginHistoryContract = defineContract({
  id: "listLoginHistory",
  method: "GET",
  path: "/api/v1/platform/login-history",
  tag: "Log Audit",
  summary: "Riwayat masuk semua akun (terbaru dulu)",
  description: [
    "Setiap login berhasil dan percobaan gagal (kata sandi salah, akun nonaktif, kata sandi sementara kedaluwarsa, dsb.) ke akun",
    "mana pun (sejak 2026-10-05; sebelumnya hanya super admin): perangkat & browser, IP, perkiraan lokasi + ISP dari IP",
    "(DB-IP Lite, bukan GPS — wajib atribusi \"IP Geolocation by DB-IP\"), dan penanda perangkat baru. Filter `userId`, `role`, `schoolId`.",
  ].join(" "),
  action: "audit.login.read",
  query: loginHistoryQuery,
  response: z.array(loginEventSchema),
  pagination: "page",
});

export const loginHistoryContracts: readonly AnyContract[] = [listLoginHistoryContract];
