import { z } from "zod";
import { IDENTIFIER_MAX, NISN_PATTERN } from "./constants";

/**
 * Klasifikasi identifier login (murni). Tepat 10 digit = NISN (hanya akun STUDENT); selain itu
 * harus email valid (di-lowercase; hanya akun non-STUDENT). Lainnya INVALID (400).
 */
export type IdentifierKind =
  | { readonly kind: "NISN"; readonly nisn: string }
  | { readonly kind: "EMAIL"; readonly email: string }
  | { readonly kind: "INVALID" };

const INVALID: IdentifierKind = Object.freeze({ kind: "INVALID" });
const RESERVED_NISN = "0000000000";
const emailSchema = z.email().max(IDENTIFIER_MAX);

export function classifyIdentifier(raw: string): IdentifierKind {
  const value = raw.trim();
  if (NISN_PATTERN.test(value)) return value === RESERVED_NISN ? INVALID : { kind: "NISN", nisn: value };
  if (!value.includes("@")) return INVALID;
  const email = value.toLowerCase();
  return emailSchema.safeParse(email).success ? { kind: "EMAIL", email } : INVALID;
}

/** Bentuk ternormalisasi untuk key limiter (NISN apa adanya, email lowercase); INVALID -> null. */
export function limiterIdentifier(identifier: IdentifierKind): string | null {
  if (identifier.kind === "NISN") return identifier.nisn;
  if (identifier.kind === "EMAIL") return identifier.email;
  return null;
}
