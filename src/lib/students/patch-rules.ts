import type { LocalDate } from "@/lib/time/zone";
import type { GapField } from "./activation-rules";
import type { GenderValue, StudentStatusValue } from "./constants";

/** Aturan PATCH siswa (murni): selisih field & izin ganti NISN. */
export interface PatchableSnapshot {
  readonly name: string;
  readonly nisn: string;
  readonly nis: string;
  readonly gender: GenderValue;
  readonly birthPlace: string | null;
  readonly birthDate: LocalDate | null;
  readonly address: string | null;
  readonly guardianName: string | null;
  readonly guardianPhone: string | null;
  readonly currentClassId: string | null;
  readonly sppAmount: number | null;
}

export type PatchField = keyof PatchableSnapshot;
export type StudentPatch = { readonly [K in PatchField]?: PatchableSnapshot[K] | undefined };

const PATCH_FIELDS: readonly PatchField[] = [
  "name", "nisn", "nis", "gender", "birthPlace", "birthDate", "address", "guardianName", "guardianPhone", "currentClassId", "sppAmount",
];

/** Field yang dikirim DAN nilainya berbeda dari data sekarang. */
export function diffStudentPatch(current: PatchableSnapshot, patch: StudentPatch): StudentPatch {
  return Object.fromEntries(
    PATCH_FIELDS.filter((field) => patch[field] !== undefined && patch[field] !== current[field]).map((field) => [field, patch[field]]),
  ) as StudentPatch;
}

const GAP_FIELDS: ReadonlySet<string> = new Set<GapField>([
  "name", "nisn", "nis", "gender", "birthPlace", "birthDate", "address", "guardianName", "guardianPhone", "currentClassId",
]);

export function gapFieldsOf(changes: StudentPatch): Set<GapField> {
  return new Set(Object.keys(changes).filter((key): key is GapField => GAP_FIELDS.has(key)));
}

/** NISN = kunci login nasional: admin sekolah hanya boleh mengubahnya selama DRAFT. */
export function canChangeNisn(role: string, status: StudentStatusValue): boolean {
  return role === "SUPER_ADMIN" || status === "DRAFT";
}
