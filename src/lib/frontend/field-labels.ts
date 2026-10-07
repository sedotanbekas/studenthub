/**
 * Label Bahasa Indonesia untuk kunci respons API yang tampil sebagai judul kolom/detail di tampilan generik.
 * Digabung ke peta `labels` di format.ts (entri lama di sana menang bila sama). Dijaga field-labels.test.ts:
 * kunci respons baru pada operasi menu wajib ditambahkan di sini.
 */
export const FIELD_LABELS: Readonly<Record<string, string>> = {
  // Akun, sesi, & keamanan
  logins: "ID login", plain: "Kata sandi", expired: "Kedaluwarsa", changedAt: "Diganti pada", adminKind: "Jenis admin",
  accountCounts: "Jumlah akun", schoolAdmins: "Admin sekolah",
  accessToken: "Token akses", accessTokenExpiresAt: "Token akses berlaku sampai", refreshToken: "Token penyegar", refreshTokenExpiresAt: "Token penyegar berlaku sampai",
  user: "Pengguna", trustedDevice: "Perangkat tepercaya", token: "Token", expiresAt: "Berlaku sampai", revoked: "Dicabut", revokedCount: "Sesi dicabut",
  totpEnabled: "Verifikasi 2 langkah aktif", totpEnrollmentRequired: "Wajib daftar verifikasi 2 langkah", permissions: "Hak akses", changed: "Diubah",
  otherSessionsRevoked: "Sesi lain dicabut", registered: "Terdaftar", removed: "Dihapus", issuer: "Penerbit", accountName: "Nama akun", algorithm: "Algoritma",
  digits: "Jumlah digit", period: "Periode", enabled: "Aktif", enabledAt: "Diaktifkan pada", since: "Aktif sejak", testMode: "Mode uji absensi", passwordChangedAt: "Kata sandi diubah pada", activeSessionCount: "Sesi aktif",
  // Akun admin sekolah (guru/wali kelas)
  isPrimary: "Admin utama", admin: "Akun admin",
  // Riwayat masuk super admin
  occurredAt: "Waktu", failureReason: "Alasan gagal", device: "Perangkat & browser", isNewDevice: "Perangkat baru", location: "Perkiraan lokasi",
  isp: "Penyedia internet (ISP)", deviceType: "Jenis perangkat", browser: "Browser", os: "Sistem operasi", deviceModel: "Model perangkat",
  countryCode: "Kode negara", userAgent: "User-agent",
  // Tema sekolah
  theme: "Tema", preset: "Preset tema", primaryColor: "Warna utama", secondaryColor: "Warna kedua", bannerColor: "Warna banner", animationColor: "Warna animasi",
  logoColor: "Warna logo", isCustom: "Tema khusus",
  // Sekolah & wilayah
  province: "Provinsi", city: "Kabupaten / kota", region: "Wilayah", regionProvinceCode: "Provinsi wilayah", regionCityCode: "Kabupaten / kota wilayah", provinceName: "Provinsi", cityName: "Kabupaten / kota", activeStudentCount: "Siswa aktif",
  geofenceUpdatedAt: "Lokasi diubah pada", schedule: "Jadwal absensi", checkInOpen: "Absen dibuka", start: "Jam masuk", lateAfter: "Terlambat setelah",
  checkInClose: "Absen ditutup", dayEnd: "Akhir hari sekolah", schoolDays: "Hari sekolah", counts: "Jumlah", studentsByStatus: "Siswa per status",
  adminCount: "Jumlah admin", activeAdminCount: "Admin aktif", revokedSessions: "Sesi dicabut", activeTerm: "Semester aktif", setupChecklist: "Kesiapan sekolah",
  today: "Hari ini", hasActiveTerm: "Ada semester aktif", hasTermToday: "Semester mencakup hari ini", nextTermStartDate: "Semester berikutnya mulai",
  classCount: "Jumlah kelas", subjectCount: "Jumlah mapel", holidayCount: "Jumlah libur sekolah", entityType: "Jenis data", entityId: "Rujukan data", deviceId: "Sidik perangkat",
  // Akademik & kalender
  academicYear: "Tahun ajaran", academicYearName: "Tahun ajaran", terms: "Semester", activeStudentsOutsideYear: "Siswa aktif di luar tahun ajaran",
  subjects: "Mata pelajaran", subject: "Mata pelajaran", sortOrder: "Urutan", orphanGradeCount: "Nilai tanpa mapel", dayCount: "Jumlah hari",
  schoolDayCount: "Jumlah hari sekolah", days: "Hari", holidayName: "Nama libur", nonSchoolDays: "Bukan hari sekolah", months: "Bulan",
  // Siswa & impor
  status: "Status", email: "Email", sponsor: "Sponsor", platform: "Platform", hasActiveNisn: "NISN aktif", activatedAt: "Diaktifkan pada",
  activationGaps: "Data yang belum lengkap", field: "Kolom", message: "Pesan", nisnReleased: "NISN dilepas", deleted: "Dihapus", report: "Laporan",
  totalRows: "Total baris", validRows: "Baris valid", errorRows: "Baris bermasalah", warningRows: "Baris berperingatan", rows: "Baris", row: "Baris",
  errors: "Galat", warnings: "Peringatan", created: "Dibuat", credentials: "Data masuk siswa", students: "Siswa", studentStatus: "Status siswa",
  // Notifikasi & pengumuman
  category: "Kategori", data: "Data", screen: "Layar tujuan", count: "Jumlah", total: "Total", announcements: "Pengumuman", announcement: "Pengumuman",
  personal: "Pribadi", kind: "Jenis notifikasi", mutedCategories: "Kabar yang dimatikan", mutableCategories: "Kabar yang bisa diatur", updatedBy: "Diubah oleh", latestCreatedAt: "Terbaru pada", updated: "Diperbarui", recipientCount: "Jumlah penerima", author: "Penulis", readCount: "Dibaca",
  cancelledAt: "Dibatalkan pada", stats: "Statistik", notified: "Diberi tahu",
  // Absensi
  serverTime: "Waktu server", ianaTimezone: "Zona waktu (IANA)", schoolDay: "Hari sekolah", window: "Jendela absen", opensAt: "Dibuka pukul",
  closesAt: "Ditutup pukul", state: "Keadaan", geofence: "Area sekolah", maxAccuracyM: "Akurasi maksimal (m)", record: "Catatan", source: "Sumber",
  lateMinutes: "Terlambat (menit)", pendingLeave: "Izin menunggu", canCheckIn: "Bisa absen", blockReason: "Alasan belum bisa absen", ok: "Lolos",
  distanceM: "Jarak (m)", wouldBeLate: "Akan terlambat", checkInAt: "Waktu absen", replayed: "Diulang", summary: "Ringkasan", recorded: "Tercatat",
  izin: "Izin", sakit: "Sakit", hadir: "Hadir", terlambat: "Terlambat", closedThrough: "Ditutup sampai", leaveRequest: "Pengajuan izin",
  materialized: "Diterapkan", converted: "Dikonversi", skipped: "Dilewati", reviewedBy: "Ditinjau oleh", unchanged: "Tidak berubah",
  skippedReason: "Alasan dilewati", planned: "Direncanakan", inserted: "Ditulis", alphaPlanned: "Alpa direncanakan", leavePlanned: "Izin direncanakan",
  anomaliesSwept: "Anomali ditandai", accuracyM: "Akurasi (m)", points: "Titik", unlocated: "Tanpa lokasi", rejected: "Ditolak", reasonLabel: "Alasan",
  isMocked: "Lokasi palsu", timeLocal: "Jam", truncated: "Terpotong", classes: "Kelas", totals: "Total", isPartial: "Sebagian",
  unclosedDates: "Tanggal belum ditutup", latePct: "Terlambat (%)", izinPct: "Izin (%)", sakitPct: "Sakit (%)", alphaPct: "Alpa (%)",
  prevMonth: "Bulan lalu", prevPresentPct: "Kehadiran bulan lalu (%)", deltaPp: "Selisih (poin)", locationCapturedAt: "Lokasi diambil pada",
  severity: "Tingkat", purged: "Dihapus", rejectionsSameDay: "Penolakan hari yang sama", audit: "Audit", attendanceToday: "Kehadiran hari ini",
  lateReason: "Alasan terlambat", lateReasonCategory: "Alasan terlambat", lateReasonEditable: "Alasan bisa diubah", filled: "Sudah diisi",
  unfilled: "Belum diisi", categories: "Per kategori",
  decision: "Keputusan", statusChanged: "Status berubah", needsReview: "Perlu ditinjau", reviewDecision: "Hasil tinjauan", review: "Tinjauan",
  reviewer: "Peninjau", anomaly: "Anomali", any: "Ada anomali", unreviewed: "Belum ditinjau", UNREVIEWED: "Belum ditinjau", ALL_ANOMALIES: "Semua anomali",
  isFinal: "Data final", day: "Tanggal", weekday: "Hari", closure: "Status penutupan hari", cells: "Kode per tanggal",
  otherClasses: "Tercatat juga di kelas", lateReasons: "Alasan terlambat per kategori",
  // Rapor
  reportCardStatus: "Status rapor", blockedReason: "Alasan terhambat", createdReportCards: "Rapor dibuat", isMapped: "Dipetakan ke kelas",
  isSnapshot: "Salinan saat terbit", ready: "Siap terbit", incomplete: "Belum lengkap", noReportCard: "Belum punya rapor",
  attendanceUnclosedDates: "Tanggal absensi belum ditutup", reportCards: "Rapor", activeStudents: "Siswa aktif", studentsWithGrades: "Siswa bernilai",
  studentsComplete: "Siswa lengkap",
  // Tagihan & pembayaran
  voidedAt: "Dibatalkan pada", invoiceNoFrom: "Nomor tagihan dari", invoiceNoTo: "Nomor tagihan sampai", skippedCount: "Jumlah dilewati", hint: "Petunjuk",
  voidedBy: "Dibatalkan oleh", recordedBy: "Dicatat oleh", issuedAt: "Diterbitkan pada", possibleDuplicateOf: "Kemungkinan duplikat dari", history: "Riwayat",
  submission: "Bukti transfer", billing: "Tagihan", studentsNotFullyPaid: "Siswa belum lunas", studentsOverdue: "Siswa lewat jatuh tempo",
  pendingVerification: "Menunggu verifikasi", invoiced: "Ditagihkan", paid: "Lunas", partial: "Sebagian", unpaid: "Belum bayar", void: "Dibatalkan",
  billedAmount: "Total ditagihkan", collectedAmount: "Terkumpul", accountNumber: "Nomor rekening", accountHolder: "Pemilik rekening",
  // Sponsor, iklan, & platform
  statusReason: "Alasan status", pendingTopUps: "Top-up menunggu", pendingAdReviews: "Iklan menunggu tinjauan", members: "Anggota",
  balanceSummary: "Ringkasan saldo", totalTopUp: "Total top-up", totalSpent: "Total terpakai", netAdjustment: "Penyesuaian bersih",
  estimatedClicksRemaining: "Perkiraan sisa klik", seq: "Urutan", balanceAfter: "Saldo setelahnya", duplicateProofOf: "Duplikat bukti dari", topUp: "Top-up",
  ledgerEntry: "Catatan saldo", defaultCpcAmount: "Biaya per klik bawaan", minTopUpAmount: "Minimal top-up", topUpBankName: "Bank top-up",
  topUpAccountNumber: "Nomor rekening top-up", topUpAccountHolder: "Pemilik rekening top-up", deepLinkSchemes: "Skema tautan aplikasi",
  // Analitik SPP (2026-10-07).
  asOf: "Per tanggal", billed: "Total tagihan", breakdown: "Rincian", childLevel: "Tingkat rincian", collectionRate: "Tingkat penagihan (%)", invoices: "Jumlah tagihan",
  lateInvoices: "Lunas telat", lateStudents: "Siswa lunas telat", notDue: "Belum jatuh tempo", oldestDueDate: "Jatuh tempo terlama", onTime: "Lunas tepat waktu",
  outstanding: "Sisa tunggakan", overdue: "Menunggak", overdueInvoices: "Tagihan menunggak", overdueStudents: "Siswa menunggak", trend: "Tren",
  appName: "Nama aplikasi", defaultAppName: "Nama bawaan", logoUrl: "Alamat logo", logoUpdatedAt: "Logo diganti",
  lowBalanceThreshold: "Batas saldo menipis", topUpAccount: "Rekening top-up", mimeType: "Jenis berkas", width: "Lebar", height: "Tinggi",
  sizeBytes: "Ukuran (byte)", imageUrl: "Gambar", cpcAmount: "Biaya per klik", submittedAt: "Diajukan pada", ad: "Iklan", ads: "Iklan",
  reReviewTriggered: "Perlu ditinjau ulang", prevFrom: "Periode lalu dari", prevTo: "Periode lalu sampai", kpis: "Indikator", value: "Nilai",
  previous: "Sebelumnya", changePct: "Perubahan (%)", dimension: "Dimensi", items: "Rincian", key: "Kunci", sharePct: "Porsi (%)", urlHost: "Domain tautan",
  isPunycodeHost: "Domain punycode", sponsorName: "Sponsor", refreshAfterSeconds: "Muat ulang setelah (detik)", accepted: "Diterima", duplicate: "Duplikat",
  // Pengingat absen (N5).
  leadMinutes: "Menit sebelum jam masuk", sendMinute: "Pengingat dikirim", pushReadyStudentCount: "Siswa siap menerima notifikasi HP",
  defaultSchedule: "Jadwal masih bawaan",
};
