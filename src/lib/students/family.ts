/**
 * Data keluarga & kontak siswa (murni, tanpa Prisma): nomor HP siswa, data ayah & ibu (nama, pekerjaan,
 * nomor HP), dan pekerjaan wali. Semua opsional — tidak memengaruhi aktivasi; kontak utama yang WAJIB
 * sebelum aktivasi tetap guardianName + guardianPhone (lihat activation-rules.ts). Nomor HP dinormalkan ke
 * "+628…" (phone.ts) seperti guardianPhone.
 */
export const FAMILY_FIELDS = [
  "phone",
  "fatherName",
  "fatherOccupation",
  "fatherPhone",
  "motherName",
  "motherOccupation",
  "motherPhone",
  "guardianOccupation",
] as const;
export type FamilyField = (typeof FAMILY_FIELDS)[number];
export type FamilyData = { readonly [K in FamilyField]: string | null };

export const FAMILY_PHONE_FIELDS = ["phone", "fatherPhone", "motherPhone"] as const satisfies readonly FamilyField[];
export const FAMILY_NAME_FIELDS = ["fatherName", "motherName"] as const satisfies readonly FamilyField[];
export const FAMILY_OCCUPATION_FIELDS = ["fatherOccupation", "motherOccupation", "guardianOccupation"] as const satisfies readonly FamilyField[];

export const PARENT_NAME_MAX = 100;
export const OCCUPATION_MAX = 100;

/** Label (pesan error, header impor, tampilan). */
export const FAMILY_LABELS: Readonly<Record<FamilyField, string>> = {
  phone: "Nomor HP siswa",
  fatherName: "Nama ayah",
  fatherOccupation: "Pekerjaan ayah",
  fatherPhone: "Nomor HP ayah",
  motherName: "Nama ibu",
  motherOccupation: "Pekerjaan ibu",
  motherPhone: "Nomor HP ibu",
  guardianOccupation: "Pekerjaan wali",
};

/** Saran isian pekerjaan (mengikuti kategori umum Dapodik); isian bebas tetap diterima. */
export const OCCUPATION_SUGGESTIONS: readonly string[] = [
  "PNS/TNI/Polri", "Karyawan swasta", "Karyawan BUMN/BUMD", "Wiraswasta", "Pedagang", "Petani", "Nelayan", "Peternak",
  "Buruh", "Guru/Dosen", "Tenaga kesehatan", "Sopir/Ojek", "Pensiunan", "Ibu rumah tangga", "Tidak bekerja", "Sudah meninggal", "Lainnya",
];

/** Ambil field keluarga dari objek apa pun (baris DB, input, baris impor); yang tidak ada -> null. */
export function familyOf(source: Partial<Record<FamilyField, string | null | undefined>>): FamilyData {
  return Object.fromEntries(FAMILY_FIELDS.map((field) => [field, source[field] ?? null])) as FamilyData;
}
