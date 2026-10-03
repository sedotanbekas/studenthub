import type { Operation } from "./types";

/**
 * Aturan murni halaman generik (Workspace): teks tombol yang menyebut objeknya, nama tampilan/tab, dan
 * pembagian aksi. Aksi per baris (path ber-{id}) TIDAK pernah ditaruh di tingkat halaman: tempatnya di
 * jendela detail baris, karena di sana datanya sudah jelas (tidak perlu memilih ID dari daftar). Operasi dengan
 * parameter path lain ({studentId}, {classId}, {date}) tidak bisa diisi dari baris, jadi menjadi aksi halaman yang
 * formulirnya memakai pemilih siswa/kelas.
 */
export interface ActionText {
  readonly label: string;
  /** Satu kalimat untuk menu "Lainnya" (kenapa/kapan dipakai). */
  readonly hint?: string;
}

export const ACTION_LABELS: Readonly<Record<string, ActionText>> = {
  // Tombol buat (biru)
  createSchoolStudent: { label: "Siswa baru" },
  createSchoolInvoice: { label: "Tagihan baru" },
  createSchoolAnnouncement: { label: "Pengumuman baru" },
  createSchoolHoliday: { label: "Libur sekolah baru" },
  createNationalHoliday: { label: "Libur nasional baru" },
  createPlatformSchool: { label: "Sekolah baru" },
  createPlatformUser: { label: "Pengguna baru" },
  createSchoolAdmin: { label: "Akun admin baru", hint: "Untuk guru/wali kelas; masuk dengan email, kata sandi sementara tampil sekali." },
  createSponsor: { label: "Sponsor baru" },
  createReportCard: { label: "Rapor baru", hint: "Rapor kosong untuk satu siswa; nilai diisi lewat Isi nilai per kelas." },
  createOwnLeaveRequest: { label: "Ajukan izin/sakit" },
  createSchoolLeaveRequest: { label: "Catat izin/sakit siswa" },
  createAcademicYear: { label: "Tahun ajaran baru" },
  createSchoolClass: { label: "Kelas baru" },
  createSubject: { label: "Mapel baru" },
  createAd: { label: "Kampanye baru" },
  // Aksi tingkat halaman lain
  importSchoolStudents: { label: "Impor dari Excel", hint: "Tambah banyak siswa sekaligus memakai templat Excel." },
  downloadStudentImportTemplate: { label: "Unduh templat Excel", hint: "Format kolom yang diterima impor siswa." },
  bulkCreateSchoolInvoices: { label: "Tagihan SPP massal", hint: "Satu periode untuk seluruh sekolah, kelas tertentu, atau siswa terpilih." },
  previewSchoolAnnouncementRecipients: { label: "Cek jumlah penerima", hint: "Hitung penerima sebelum pengumuman diterbitkan." },
  updateSchoolSettings: { label: "Ubah jadwal & jenjang", hint: "Jam absen, hari sekolah, dan jenjang sekolah." },
  markAllNotificationsRead: { label: "Tandai semua dibaca" },
  authChangePassword: { label: "Ganti kata sandi" },
  authLogoutAll: { label: "Keluar dari semua perangkat", hint: "Semua sesi diakhiri, termasuk perangkat ini." },
  setupMyTotp: { label: "Daftarkan verifikasi 2 langkah", hint: "Wajib untuk super admin; memakai aplikasi autentikator." },
  confirmMyTotp: { label: "Konfirmasi kode verifikasi", hint: "Masukkan kode 6 digit pertama dari aplikasi autentikator." },
  updateAdSettings: { label: "Ubah pengaturan iklan" },
  recloseAttendanceDay: { label: "Tutup ulang hari absensi", hint: "Jalankan ulang penutupan (alpa otomatis) untuk satu tanggal." },
  enableAttendanceTestMode: { label: "Longgarkan absensi (mode uji)", hint: "Sementara: siswa semua sekolah bisa absen dari mana saja dan kapan saja. Akurasi GPS & foto wajah tetap wajib." },
  disableAttendanceTestMode: { label: "Kunci kembali absensi", hint: "Absensi kembali wajib di area sekolah dan pada jam absen." },
  updateOwnSponsorProfile: { label: "Ubah kontak perusahaan" },
  upsertReportCardGrades: { label: "Isi nilai per kelas", hint: "Masukkan nilai satu mapel untuk satu kelas sekaligus." },
  publishReportCards: { label: "Terbitkan rapor kelas", hint: "Rapor yang nilainya lengkap terbit dan bisa dilihat siswa." },
  unpublishReportCards: { label: "Tarik terbit rapor", hint: "Kembalikan rapor satu kelas ke draf untuk diperbaiki." },
  correctStudentAttendanceDay: { label: "Koreksi absensi siswa", hint: "Ubah status absensi satu siswa pada satu tanggal (tercatat di riwayat)." },
  monitorStudentAttendanceMonth: { label: "Riwayat bulanan siswa", hint: "Status absensi satu siswa sepanjang satu bulan." },
  monitorAttendanceStudentTrend: { label: "Tren kehadiran siswa", hint: "Persentase kehadiran satu siswa per bulan." },
  monitorAttendanceClassTrend: { label: "Tren kehadiran kelas", hint: "Kehadiran harian satu kelas." },
  // Aksi per baris (jendela detail)
  activateSchoolStudent: { label: "Aktifkan siswa" },
  changeSchoolStudentStatus: { label: "Ubah status siswa" },
  resetSchoolStudentPassword: { label: "Reset kata sandi" },
  voidSchoolInvoice: { label: "Batalkan tagihan" },
  restoreSchoolInvoice: { label: "Pulihkan tagihan" },
  recordSchoolCashPayment: { label: "Catat bayar tunai" },
  voidSchoolPayment: { label: "Batalkan pembayaran" },
  getSchoolPaymentReceipt: { label: "Lihat kuitansi" },
  approveSchoolPaymentSubmission: { label: "Setujui bukti transfer" },
  rejectSchoolPaymentSubmission: { label: "Tolak bukti transfer" },
  publishSchoolAnnouncement: { label: "Terbitkan" },
  cancelSchoolAnnouncement: { label: "Tarik pengumuman" },
  deactivatePlatformSchool: { label: "Nonaktifkan sekolah" },
  reactivatePlatformSchool: { label: "Aktifkan kembali" },
  deactivatePlatformUser: { label: "Nonaktifkan akun" },
  activatePlatformUser: { label: "Aktifkan akun" },
  revokePlatformUserSessions: { label: "Keluarkan dari semua perangkat" },
  resetPlatformUserPassword: { label: "Reset kata sandi" },
  deactivateSchoolAdmin: { label: "Nonaktifkan akun" },
  activateSchoolAdmin: { label: "Aktifkan akun" },
  revokeSchoolAdminSessions: { label: "Keluarkan dari semua perangkat" },
  resetSchoolAdminPassword: { label: "Reset kata sandi" },
  updateSchoolAdmin: { label: "Ubah nama/email" },
  approveSponsor: { label: "Setujui sponsor" },
  suspendSponsor: { label: "Tangguhkan sponsor" },
  reactivateSponsor: { label: "Aktifkan kembali" },
  listSponsorLedgerPlatform: { label: "Riwayat saldo" },
  adjustSponsorBalance: { label: "Sesuaikan saldo" },
  cancelOwnLeaveRequest: { label: "Batalkan pengajuan" },
  submitOwnPaymentProof: { label: "Kirim bukti bayar" },
  cancelOwnPaymentSubmission: { label: "Batalkan bukti bayar" },
  getOwnPaymentReceipt: { label: "Lihat kuitansi" },
  markNotificationRead: { label: "Tandai dibaca" },
  upsertSingleReportCardGrades: { label: "Ubah nilai" },
  revokeMySession: { label: "Keluarkan perangkat ini" },
};

/** Nama tampilan (judul panel & tab). */
export const VIEW_LABELS: Readonly<Record<string, string>> = {
  listSchoolStudents: "Daftar siswa",
  listSchoolInvoices: "Tagihan",
  listSchoolPaymentSubmissions: "Bukti transfer",
  listReportCards: "Daftar rapor",
  getReportCardGradeSheet: "Lembar nilai",
  getReportCardReadiness: "Kesiapan terbit",
  listSchoolAnnouncements: "Pengumuman",
  listSchoolHolidays: "Kalender libur",
  getSchoolProfile: "Profil & kesiapan sekolah",
  listSchoolAuditLogs: "Riwayat aktivitas",
  listSchoolAdmins: "Admin & guru",
  listNotifications: "Notifikasi",
  listMySessions: "Perangkat yang masuk",
  listPlatformSchools: "Daftar sekolah",
  listPlatformUsers: "Daftar pengguna",
  listSponsors: "Daftar sponsor",
  listNationalHolidays: "Libur nasional",
  getAdSettings: "Pengaturan iklan",
  getAttendanceTestMode: "Mode uji absensi",
  listPlatformAuditLogs: "Audit platform",
  listLoginHistory: "Riwayat masuk",
  getOwnSponsorProfile: "Profil perusahaan",
  listOwnLeaveRequests: "Pengajuan saya",
  listOwnReportCards: "Rapor saya",
  listOwnInvoices: "Tagihan",
  getOwnPaymentInfo: "Rekening sekolah",
  getStudentCalendar: "Kalender",
  getOwnStudentProfile: "Profil saya",
  monitorAttendanceDaily: "Harian",
  monitorAttendanceRecap: "Rekap kelas",
  monitorAttendanceAnomalies: "Perlu ditinjau",
  monitorCheckInRejections: "Absen ditolak",
  monitorLateReasons: "Alasan terlambat",
  listSchoolLeaveRequests: "Izin & sakit",
};

/** Tampilan teknis/grafik yang sudah punya tempat sendiri (Beranda, peta) — tidak ditampilkan sebagai tab data. */
export const HIDDEN_VIEWS: ReadonlySet<string> = new Set([
  "getUnreadNotificationCount", "monitorAttendanceToday", "monitorAttendanceMap", "monitorAttendanceClassAnalytics",
  "monitorAttendanceSummaryAnalytics", "monitorAttendanceSchoolTrend",
  // Rekap bulanan punya tab sendiri (classId wajib; ekspor = unduhan berkas yang diaudit & berkuota, bukan tabel).
  "monitorAttendanceMonthlyRecap", "exportAttendanceMonthlyRecap",
]);

const isTemplate = (op: Operation): boolean => op.id.includes("Template");
const isRowLevel = (op: Operation): boolean => op.path.includes("{id}");
const hasPathParams = (op: Operation): boolean => op.path.includes("{");

/** Tampilan data yang bisa dipilih (tab): GET tanpa {id}, tampilan utama modul di depan. */
export function viewsFor(available: readonly Operation[], primaryId: string | undefined): Operation[] {
  const views = available.filter((op) => op.method === "GET" && !hasPathParams(op) && !isTemplate(op) && !HIDDEN_VIEWS.has(op.id));
  const primary = views.find((op) => op.id === primaryId);
  return primary ? [primary, ...views.filter((op) => op !== primary)] : views;
}

/** Tombol biru = buat untuk tampilan aktif (POST ke path yang sama); aksi tingkat halaman lain = sekunder. */
export function pageActions(available: readonly Operation[], viewPath: string | undefined): { create: Operation | undefined; secondary: Operation[] } {
  const pageLevel = available.filter((op) => !isRowLevel(op) && (op.method !== "GET" || isTemplate(op) || hasPathParams(op)));
  const create = pageLevel.find((op) => op.method === "POST" && op.path === viewPath);
  const rest = pageLevel.filter((op) => op !== create);
  // Aksi milik tampilan yang dibuka (mis. "Kunci kembali absensi" di tab Mode uji) didahulukan agar tidak terselip di "Lainnya".
  return { create, secondary: [...rest.filter((op) => op.path === viewPath), ...rest.filter((op) => op.path !== viewPath)] };
}

/** Path dasar jendela detail baris sebuah tampilan (baris harian absensi = catatan /school/attendance/{id}). */
export const detailBase = (viewPath: string | undefined): string | undefined =>
  viewPath === "/school/attendance/daily" || viewPath === "/school/attendance/anomalies" ? "/school/attendance" : viewPath;

/** Tabel bersarang di jendela detail (pembayaran & bukti transfer di detail tagihan) membuka detailnya sendiri. */
export const NESTED_DETAIL_BASES: readonly string[] = ["/school/payments", "/school/payment-submissions", "/student/payments", "/student/payment-submissions"];

/** Pengecualian aturan umum: membuka mode uji melonggarkan absensi semua sekolah; menguncinya kembali aman. */
const DANGER_OVERRIDES: Readonly<Record<string, boolean>> = { enableAttendanceTestMode: true, disableAttendanceTestMode: false };

/** Tindakan yang wajib dikonfirmasi ("Saya memahami dampaknya"): hapus, nonaktifkan, reset, cabut, keluar semua. */
export function isDangerAction(op: Operation): boolean {
  return DANGER_OVERRIDES[op.id] ?? (op.method === "DELETE" || /void|deactivate|reset-password|revoke|takedown|logout-all/.test(op.path));
}

export const MAX_VISIBLE_ACTIONS = 2;

export function splitActions(secondary: readonly Operation[]): { visible: Operation[]; overflow: Operation[] } {
  return { visible: secondary.slice(0, MAX_VISIBLE_ACTIONS), overflow: secondary.slice(MAX_VISIBLE_ACTIONS) };
}

/** Id yang tetap berguna bagi admin: rujukan entri audit dan sidik perangkat (investigasi titip absen). */
const MEANINGFUL_IDS = new Set(["entityId", "deviceId"]);

/** ID mentah (cuid) tidak bermakna bagi pengguna; berkas (…FileId) tetap tampil sebagai tautan. */
export function isHiddenField(key: string): boolean {
  return !/FileId$/.test(key) && !MEANINGFUL_IDS.has(key) && /^id$|Ids?$/.test(key);
}

/** Catatan kecil di bawah tabel sebuah tampilan (mis. atribusi sumber data yang diwajibkan lisensinya). */
export interface ViewNote {
  readonly text: string;
  readonly link?: { readonly href: string; readonly label: string };
}

export const VIEW_NOTES: Readonly<Record<string, ViewNote>> = {
  // Lisensi DB-IP Lite (CC BY 4.0) mewajibkan tautan balik di halaman yang menampilkan hasilnya.
  "/platform/login-history": {
    text: "Lokasi & ISP diperkirakan dari alamat IP (bukan GPS); IP seluler sering terbaca kota gerbang operator.",
    link: { href: "https://db-ip.com", label: "IP Geolocation by DB-IP" },
  },
};

/** Kolom tabel paling berguna per tampilan (isi lengkap tetap ada di jendela detail). */
export const VIEW_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  "/student/invoices": ["invoiceNo", "title", "amount", "remaining", "dueDate", "displayStatus"],
  "/student/report-cards": ["termLabel", "className", "average", "publishedAt"],
  "/student/leave-requests": ["type", "startDate", "endDate", "schoolDayCount", "status"],
  "/school/students": ["name", "nisn", "class", "gender", "status", "lastLoginAt"],
  "/school/invoices": ["invoiceNo", "student", "title", "amount", "remaining", "dueDate", "displayStatus"],
  "/school/payment-submissions": ["student", "invoice", "amount", "transferDate", "senderName", "status"],
  "/school/report-cards": ["student", "className", "gradedCount", "average", "status", "publishedAt"],
  "/school/leave-requests": ["student", "type", "startDate", "endDate", "schoolDayCount", "status"],
  "/school/attendance/anomalies": ["date", "student", "attendance", "reviewDecision"],
  "/school/attendance/rejections": ["date", "timeLocal", "student", "reasonLabel", "distanceM"],
  "/school/audit-logs": ["createdAt", "actor", "action", "entityType"],
  "/school/admins": ["name", "email", "isPrimary", "isActive", "lastLoginAt"],
  "/platform/audit-logs": ["createdAt", "actor", "action", "entityType"],
  "/platform/login-history": ["occurredAt", "user", "status", "device", "isp", "location", "ipAddress"],
  "/platform/schools": ["name", "npsn", "city", "activeStudentCount", "isActive"],
  "/platform/users": ["name", "email", "role", "school", "isActive", "lastLoginAt"],
  "/platform/sponsors": ["companyName", "contactEmail", "status", "balance", "pendingAdReviews"],
  "/me/sessions": ["deviceName", "platform", "lastUsedAt", "isCurrent"],
};
