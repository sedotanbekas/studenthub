import type { NotificationEvent } from "@/lib/notifications/notify";
import type { SchoolChangeGroup } from "@/lib/schools/rules";

/** Teks notifikasi domain sekolah (murni). */
export const SCHOOL_CHANGE_LABELS: Readonly<Record<SchoolChangeGroup, string>> = {
  IDENTITY: "identitas sekolah",
  REGION: "provinsi/kabupaten-kota",
  LOCATION: "titik lokasi & radius geofence",
  TIMEZONE: "zona waktu",
  SCHEDULE: "jadwal absensi",
  SCHOOL_DAYS: "hari sekolah",
  BANK: "rekening bank SPP",
};

const VISIBLE_DIGITS = 4;

export function maskAccountNumber(accountNumber: string): string {
  return `****${accountNumber.slice(-VISIBLE_DIGITS)}`;
}

export interface SchoolBankInfo {
  readonly bankName: string;
  readonly bankAccountNumber: string;
  readonly bankAccountHolder: string;
}

export interface SchoolSettingsChangedInput {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly changedBy: string;
  readonly groups: readonly SchoolChangeGroup[];
  /** Rekening baru bila grup BANK berubah; null = rekening dihapus; undefined = tidak berubah. */
  readonly bank?: SchoolBankInfo | null;
}

function bankSentence(input: SchoolSettingsChangedInput): string {
  if (!input.groups.includes("BANK") || input.bank === undefined) return "";
  if (input.bank === null) return " Rekening SPP dihapus.";
  const { bankName, bankAccountNumber, bankAccountHolder } = input.bank;
  return ` Rekening SPP sekarang: ${bankName} ${maskAccountNumber(bankAccountNumber)} a.n. ${bankAccountHolder}. Laporkan ke super admin bila Anda tidak mengenali perubahan ini.`;
}

/** Notifikasi ke admin sekolah saat super admin/admin mengubah konfigurasi sekolah. */
export function schoolSettingsChangedEvent(input: SchoolSettingsChangedInput): NotificationEvent {
  const labels = input.groups.map((group) => SCHOOL_CHANGE_LABELS[group]).join(", ");
  const attendanceNote =
    input.groups.some((g) => g === "LOCATION" || g === "TIMEZONE" || g === "SCHEDULE" || g === "SCHOOL_DAYS")
      ? " Data absensi yang sudah tercatat tidak diubah."
      : "";
  return {
    type: "SCHOOL_SETTINGS_CHANGED",
    title: input.groups.includes("BANK") ? "Rekening SPP sekolah diubah" : "Pengaturan sekolah diubah",
    body: `${input.changedBy} mengubah ${labels} untuk ${input.schoolName}.${bankSentence(input)}${attendanceNote}`,
    link: { screen: "school-settings", id: input.schoolId },
  };
}
