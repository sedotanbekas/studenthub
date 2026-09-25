import type { Module, Role } from "./types";
const moduleOf = (key: string, title: string, description: string, icon: string, group: string, paths: string[], primary?: string): Module => ({ key, title, description, icon, group, paths, primary });
const school: Module[] = [
  moduleOf("students", "Data siswa", "Setiap siswa, satu tempat untuk tumbuh.", "users", "SEKOLAH", ["/school/students"], "listSchoolStudents"),
  moduleOf("attendance", "Kehadiran", "Pantau kehadiran dan mulai hari dengan lebih tenang.", "check", "SEKOLAH", ["/school/attendance", "/school/leave-requests"], "monitorAttendanceDaily"),
  moduleOf("academics", "Akademik", "Susun tahun ajaran, kelas, dan mata pelajaran.", "book", "SEKOLAH", ["/school/academic-years", "/school/terms", "/school/active-term", "/school/classes", "/school/subjects"], "listSchoolClasses"),
  moduleOf("reports", "Rapor siswa", "Catat proses belajar. Rayakan setiap kemajuan.", "report", "SEKOLAH", ["/school/report-cards"], "listReportCards"),
  moduleOf("billing", "Tagihan & pembayaran", "Kelola SPP dan verifikasi pembayaran dengan mudah.", "wallet", "MANAJEMEN", ["/school/invoices", "/school/payment-submissions", "/school/payments"], "listSchoolInvoices"),
  moduleOf("announcements", "Pengumuman", "Informasi yang tepat, untuk semua yang membutuhkan.", "megaphone", "MANAJEMEN", ["/school/announcements"], "listSchoolAnnouncements"),
  moduleOf("calendar", "Kalender sekolah", "Rencanakan hari belajar dan hari libur bersama.", "calendar", "MANAJEMEN", ["/school/holidays"], "listSchoolHolidays"),
  moduleOf("school-settings", "Pengaturan sekolah", "Profil, jadwal kehadiran, dan kesiapan sekolah.", "settings", "LAINNYA", ["/school/profile", "/school/settings"], "getSchoolProfile"),
  moduleOf("school-theme", "Tema sekolah", "Warna aplikasi sesuai identitas sekolahmu.", "palette", "LAINNYA", ["/school/theme"], "getSchoolTheme"),
  moduleOf("audit", "Riwayat aktivitas", "Jejak perubahan untuk pengelolaan yang transparan.", "history", "LAINNYA", ["/school/audit-logs"], "listSchoolAuditLogs"),
];
const platform: Module[] = [
  moduleOf("schools", "Sekolah", "Hubungkan sekolah dan bangun ekosistem pendidikan.", "school", "PLATFORM", ["/platform/schools"], "listPlatformSchools"),
  moduleOf("users", "Pengguna", "Kelola akun dan akses administrator.", "users", "PLATFORM", ["/platform/users"], "listPlatformUsers"),
  moduleOf("sponsors", "Sponsor", "Kelola mitra dan persetujuan sponsor.", "heart", "PLATFORM", ["/platform/sponsors"], "listSponsors"),
  moduleOf("ad-review", "Moderasi iklan", "Tinjau konten sebelum menjangkau siswa.", "image", "PLATFORM", ["/platform/ads"], "listPlatformAds"),
  moduleOf("topups", "Verifikasi top-up", "Tinjau bukti transfer dan pengisian saldo sponsor.", "wallet", "PLATFORM", ["/platform/topups"], "listPlatformTopUps"),
  moduleOf("national-calendar", "Libur nasional", "Satu kalender bersama untuk seluruh sekolah.", "calendar", "PLATFORM", ["/platform/holidays"], "listNationalHolidays"),
  moduleOf("platform-settings", "Pengaturan platform", "Atur tarif iklan, rekening, dan penutupan absensi.", "settings", "LAINNYA", ["/platform/settings", "/platform/attendance"], "getAdSettings"),
  moduleOf("platform-audit", "Audit platform", "Telusuri aktivitas pengelolaan platform.", "history", "LAINNYA", ["/platform/audit-logs"], "listPlatformAuditLogs"),
];
const sponsor: Module[] = [
  moduleOf("campaigns", "Kampanye saya", "Ide baik layak menjangkau lebih banyak orang.", "megaphone", "SPONSOR", ["/sponsor/ads", "/sponsor/banners", "/sponsor/targeting"], "listOwnAds"),
  moduleOf("analytics", "Analitik", "Pahami jangkauan dan performa kampanye Anda.", "chart", "SPONSOR", ["/sponsor/analytics"], "getAdAnalyticsSummary"),
  moduleOf("balance", "Saldo & top-up", "Pantau saldo, pengisian, dan riwayat transaksi.", "wallet", "SPONSOR", ["/sponsor/balance", "/sponsor/topups", "/sponsor/ledger"], "getOwnSponsorBalance"),
  moduleOf("company", "Profil perusahaan", "Lengkapi informasi dan kontak perusahaan.", "school", "LAINNYA", ["/sponsor/profile"], "getOwnSponsorProfile"),
];
const student: Module[] = [
  moduleOf("my-attendance", "Absensi", "Absen masuk dengan lokasi dan foto wajah dari HP.", "location", "RUANG SISWA", ["/student/attendance"], "getOwnAttendanceToday"),
  moduleOf("my-leave", "Izin & sakit", "Ajukan izin atau sakit beserta lampirannya.", "calendar", "RUANG SISWA", ["/student/leave-requests"], "listOwnLeaveRequests"),
  moduleOf("my-reports", "Rapor saya", "Lihat hasil belajar dan perkembanganmu.", "report", "RUANG SISWA", ["/student/report-cards"], "listOwnReportCards"),
  moduleOf("my-billing", "Tagihan saya", "Lihat tagihan, kirim bukti bayar, dan unduh kuitansi.", "wallet", "RUANG SISWA", ["/student/invoices", "/student/payment-submissions", "/student/payments", "/student/payment-info"], "listOwnInvoices"),
  moduleOf("my-calendar", "Kalender belajar", "Lihat hari belajar dan libur sekolahmu.", "calendar", "RUANG SISWA", ["/student/calendar"], "getStudentCalendar"),
  moduleOf("my-profile", "Profil saya", "Informasi diri dan data sekolahmu.", "users", "LAINNYA", ["/student/profile"], "getOwnStudentProfile"),
];
const common: Module[] = [
  moduleOf("notifications", "Notifikasi", "Semua kabar terbaru, tersimpan di sini.", "bell", "LAINNYA", ["/notifications"], "listNotifications"),
  moduleOf("security", "Keamanan akun", "Kelola kata sandi, autentikasi, dan perangkat aktif.", "shield", "LAINNYA", ["/auth/change-password", "/auth/logout-all", "/me/sessions", "/me/totp"], "listMySessions"),
];
export function modulesFor(role: Role): Module[] {
  return [...(role === "SUPER_ADMIN" ? [...platform, ...school] : role === "SPONSOR" ? sponsor : role === "STUDENT" ? student : school), ...common];
}
/** Bagian hub dari pathname: /hub -> "dashboard", /hub/x/... -> "x". */
export function sectionFromPath(pathname: string): string {
  return pathname.split("/").filter(Boolean)[1] ?? "dashboard";
}
const ALL_SECTION_KEYS = new Set(["dashboard", ...[...platform, ...school, ...sponsor, ...student, ...common].map(m => m.key)]);
/** Bagian yang ada untuk salah satu peran (URL asal-asalan tetap "tidak ditemukan"). */
export function isKnownSection(section: string): boolean {
  return ALL_SECTION_KEYS.has(section);
}
/** Akun terbatas: wajib ganti kata sandi awal atau wajib daftar TOTP sebelum memakai fitur lain. */
export function isRestricted(identity: { user: { mustChangePassword: boolean; totpEnrollmentRequired: boolean } }): boolean {
  return identity.user.mustChangePassword || identity.user.totpEnrollmentRequired;
}
/** Beranda selalu boleh; selain itu hanya modul milik peran tersebut (URL peran lain -> kembali ke beranda). */
export function sectionAllowed(role: Role, section: string): boolean {
  return section === "dashboard" || modulesFor(role).some(m => m.key === section);
}
/** Halaman yang ditampilkan: akun terbatas (wajib ganti sandi/TOTP) selalu ke "Keamanan akun". */
export function resolveSection(role: Role, restricted: boolean, section: string): { home: boolean; module: Module | undefined } {
  const key = restricted ? "security" : section;
  return { home: !restricted && section === "dashboard", module: key === "dashboard" ? undefined : modulesFor(role).find(m => m.key === key) };
}

export interface TabItem { readonly key: string; readonly label: string; readonly icon: string; readonly href: string }
/** Tujuan utama tab bar HP per peran (selain beranda); sisanya lewat tombol Menu. */
const TAB_KEYS: Record<Role, readonly [string, string][]> = {
  STUDENT: [["my-attendance", "Absensi"], ["my-reports", "Rapor"], ["my-billing", "Tagihan"]],
  SCHOOL_ADMIN: [["students", "Siswa"], ["attendance", "Kehadiran"], ["billing", "Tagihan"]],
  SPONSOR: [["campaigns", "Kampanye"], ["analytics", "Analitik"], ["balance", "Saldo"]],
  SUPER_ADMIN: [["schools", "Sekolah"], ["users", "Pengguna"], ["sponsors", "Sponsor"]],
};
export function tabItems(role: Role): TabItem[] {
  const modules = modulesFor(role);
  const tabs = TAB_KEYS[role].flatMap(([key, label]) => { const m = modules.find(x => x.key === key); return m ? [{ key, label, icon: m.icon, href: `/hub/${key}` }] : []; });
  return [{ key: "dashboard", label: "Beranda", icon: "grid", href: "/hub" }, ...tabs];
}
export const roleLabels: Record<Role, string> = { SCHOOL_ADMIN: "Admin sekolah", SUPER_ADMIN: "Super admin", SPONSOR: "Sponsor", STUDENT: "Siswa" };
