/** Label Bahasa Indonesia untuk kode enum API (dipakai frontend lewat GET /api/v1/meta/enums). */
export const ENUM_LABELS = {
  UserRole: { SUPER_ADMIN: "Super Admin", SCHOOL_ADMIN: "Admin Sekolah", SPONSOR: "Sponsor", STUDENT: "Siswa" },
  StudentStatus: { DRAFT: "Draf", ACTIVE: "Aktif", INACTIVE: "Nonaktif", GRADUATED: "Lulus", MOVED: "Pindah" },
  Gender: { MALE: "Laki-laki", FEMALE: "Perempuan" },
  SchoolTimezone: { WIB: "WIB (UTC+7)", WITA: "WITA (UTC+8)", WIT: "WIT (UTC+9)" },
  Semester: { GANJIL: "Ganjil", GENAP: "Genap" },
  AttendanceStatus: { HADIR: "Hadir", TERLAMBAT: "Terlambat", IZIN: "Izin", SAKIT: "Sakit", ALPHA: "Alpha" },
  AttendanceSource: { CHECKIN: "Check-in", LEAVE: "Pengajuan izin/sakit", AUTO_ALPHA: "Alpha otomatis", ADMIN: "Koreksi admin" },
  LeaveType: { IZIN: "Izin", SAKIT: "Sakit" },
  ReviewStatus: { PENDING: "Menunggu", APPROVED: "Disetujui", REJECTED: "Ditolak", CANCELLED: "Dibatalkan" },
  ReportCardStatus: { DRAFT: "Draf", PUBLISHED: "Terbit" },
  InvoiceStatus: { UNPAID: "Belum Bayar", PARTIAL: "Sebagian", PAID: "Lunas", VOID: "Dibatalkan" },
  InvoiceDisplayStatus: {
    BELUM_BAYAR: "Belum Bayar", SEBAGIAN: "Sebagian", MENUNGGU_VERIFIKASI: "Menunggu Verifikasi",
    JATUH_TEMPO: "Jatuh Tempo", LUNAS: "Lunas", DIBATALKAN: "Dibatalkan",
  },
  PaymentMethod: { TRANSFER: "Transfer", CASH: "Tunai" },
  NotificationCategory: {
    ACADEMIC: "Akademik", FINANCE: "Keuangan", EVENT: "Kegiatan", CALENDAR: "Kalender", STUDENT_AFFAIRS: "Kesiswaan", SYSTEM: "Sistem",
  },
  AnnouncementAudience: { ALL: "Semua siswa", CLASSES: "Kelas tertentu", STUDENTS: "Siswa tertentu" },
  AnnouncementStatus: { DRAFT: "Draf", PUBLISHED: "Terbit", CANCELLED: "Ditarik" },
  SponsorStatus: { PENDING: "Menunggu persetujuan", APPROVED: "Disetujui", SUSPENDED: "Ditangguhkan" },
  AdStatus: { DRAFT: "Draf", PENDING_REVIEW: "Menunggu review", APPROVED: "Disetujui", REJECTED: "Ditolak", PAUSED: "Dijeda", ARCHIVED: "Diarsipkan" },
  AdTargetScope: { ALL: "Semua sekolah", PROVINCE: "Provinsi", CITY: "Kabupaten/Kota", SCHOOL: "Sekolah tertentu" },
  DeviceType: { MOBILE: "Mobile", TABLET: "Tablet", DESKTOP: "Desktop" },
  LedgerEntryType: { TOPUP: "Top up", CLICK_CHARGE: "Biaya klik", ADJUSTMENT: "Penyesuaian" },
} as const;

export type EnumLabels = typeof ENUM_LABELS;
