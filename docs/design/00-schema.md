# Student Hub: Prisma schema design

I read the lims-sotoy schema to match its conventions. I did not write any files, run anything or connect to the VPS.

Six choices below differ from the lead's defaults. Each one is marked **DEVIATION** in section 2 with the reason.

## 1. schema.prisma

Split into one file per domain under `prisma/schema/` (Prisma multi-file schema; `prisma.config.ts` → `schema: "prisma/schema"`). A single file would be about 900 lines, which breaks the client's 800-line limit. The `// ===== file =====` markers show where each file starts.

```prisma
// ===================== prisma/schema/schema.prisma =====================
// Konvensi global:
// - Nilai enum baru WAJIB ditambahkan di UJUNG daftar (MariaDB menyimpan ENUM sebagai indeks).
// - Uang = Int rupiah (batas divalidasi zod + CHECK). Koordinat = Decimal(10,7).
// - Jam harian = menit sejak 00:00 waktu lokal sekolah (SmallInt), BUKAN @db.Time.
// - @db.Date = tanggal LOKAL (sekolah / Asia/Jakarta untuk analitik iklan), ditulis sebagai
//   UTC-midnight: new Date("2026-09-21T00:00:00.000Z"). DateTime biasa = instant UTC.
//   Proses Node WAJIB berjalan dengan TZ=UTC.
// - Tidak ada hapus keras untuk data akademik/keuangan/audit: isActive / VOID / ARCHIVED / CANCELLED.
// - Tabel ber-schoolId selalu difilter schoolId dari sesi; schoolId anak == schoolId induk
//   (invarian service, diuji).
// - Baris append-only (ledger, klik, audit, target) sengaja tanpa updatedAt.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
}

/// Status tinjauan bersama untuk LeaveRequest, PaymentSubmission, TopUpRequest.
enum ReviewStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

// ===================== prisma/schema/auth.prisma =====================

enum UserRole {
  SUPER_ADMIN
  SCHOOL_ADMIN
  SPONSOR
  STUDENT
}

enum ClientPlatform {
  ANDROID
  IOS
  WEB
}

enum SessionRevokeReason {
  LOGOUT
  TOKEN_REUSE
  PASSWORD_CHANGED
  ACCOUNT_DISABLED
  ADMIN_REVOKED
  REPLACED
}

/// Akun login semua peran. Tidak pernah dihapus: nonaktifkan lewat isActive.
/// Cakupan (service + CHECK migrasi):
///   SUPER_ADMIN  -> schoolId NULL, sponsorId NULL
///   SCHOOL_ADMIN -> schoolId WAJIB, sponsorId NULL
///   STUDENT      -> schoolId WAJIB, sponsorId NULL, tepat satu Student
///   SPONSOR      -> sponsorId WAJIB, schoolId NULL
model User {
  id                 String    @id @default(cuid())
  role               UserRole
  /// Nama tampilan; untuk siswa inilah nama lengkap (tidak diduplikasi di Student).
  name               String    @db.VarChar(100)
  /// Login staf/sponsor/super admin (kolasi _ci => unik tanpa peka huruf). Siswa login via Student.activeNisn.
  email              String?   @unique @db.VarChar(191)
  /// bcrypt; di-omit global di src/lib/db.ts.
  passwordHash       String    @db.VarChar(100)
  schoolId           String?
  sponsorId          String?
  isActive           Boolean   @default(true)
  /// true setelah password di-set/di-reset admin; semua endpoint selain ganti password -> 403.
  mustChangePassword Boolean   @default(false)
  passwordChangedAt  DateTime?
  /// Klaim `ver` di access token; dinaikkan saat ganti password / nonaktif / paksa logout.
  tokenVersion       Int       @default(0)
  lastLoginAt        DateTime?

  school  School?  @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  sponsor Sponsor? @relation("SponsorMembers", fields: [sponsorId], references: [id], onDelete: Restrict)

  student               Student?
  sessions              AuthSession[]
  notifications         Notification[]
  announcementsAuthored Announcement[]
  reportCardsPublished  ReportCard[]
  leaveReviews          LeaveRequest[]
  invoicesVoided        Invoice[]
  submissionReviews     PaymentSubmission[]
  paymentsRecorded      Payment[]            @relation("PaymentRecordedBy")
  paymentsVoided        Payment[]            @relation("PaymentVoidedBy")
  sponsorsReviewed      Sponsor[]            @relation("SponsorReviewer")
  adsReviewed           Ad[]
  adClicks              AdClick[]
  topUpReviews          TopUpRequest[]
  ledgerEntries         SponsorLedgerEntry[]
  filesUploaded         StoredFile[]
  auditLogs             AuditLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, role, isActive])
  @@index([sponsorId])
}

/// Satu login pada satu perangkat = satu "family" refresh token.
/// Token pengganti yang dipakai ulang -> seluruh sesi dicabut (TOKEN_REUSE).
model AuthSession {
  id            String               @id @default(cuid())
  userId        String
  platform      ClientPlatform
  deviceId      String?              @db.VarChar(100)
  deviceName    String?              @db.VarChar(100)
  /// Token Expo milik sesi ini. Unik: satu HP hanya menerima push milik SATU sesi aktif.
  /// Di-NULL-kan saat logout/revoke atau saat Expo membalas DeviceNotRegistered.
  expoPushToken String?              @unique @db.VarChar(255)
  ipAddress     String?              @db.VarChar(45)
  userAgent     String?              @db.VarChar(255)
  lastUsedAt    DateTime             @default(now())
  /// Batas umur absolut family (tidak diperpanjang oleh rotasi).
  expiresAt     DateTime
  revokedAt     DateTime?
  revokeReason  SessionRevokeReason?

  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, revokedAt])
  @@index([expiresAt])
}

/// Hanya hash SHA-256 dari token opak yang disimpan.
model RefreshToken {
  id        String    @id @default(cuid())
  sessionId String
  tokenHash String    @unique @db.Char(64)
  expiresAt DateTime
  /// Diisi saat ditukar (CAS: updateMany where rotatedAt IS NULL). Dipakai lagi => reuse.
  rotatedAt DateTime?

  session AuthSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sessionId])
}

// ===================== prisma/schema/school.prisma =====================

enum SchoolTimezone {
  WIB
  WITA
  WIT
}

enum Semester {
  GANJIL
  GENAP
}

/// Referensi wilayah (kode Kemendagri). Diisi lewat migrasi (insert idempoten).
model Province {
  code String @id @db.VarChar(2)
  name String @db.VarChar(100)

  cities    City[]
  schools   School[]
  adTargets AdTarget[]
}

/// Kabupaten/kota, kode "32.73".
model City {
  code         String @id @db.VarChar(5)
  provinceCode String @db.VarChar(2)
  name         String @db.VarChar(100)

  province  Province   @relation(fields: [provinceCode], references: [code], onDelete: Restrict)
  schools   School[]
  adTargets AdTarget[]

  @@index([provinceCode])
}

model School {
  id                   String         @id @default(cuid())
  npsn                 String?        @unique @db.Char(8)
  name                 String         @db.VarChar(150)
  address              String?        @db.Text
  provinceCode         String         @db.VarChar(2)
  cityCode             String         @db.VarChar(5)
  latitude             Decimal        @db.Decimal(10, 7)
  longitude            Decimal        @db.Decimal(10, 7)
  geofenceRadiusM      Int            @default(150) @db.SmallInt
  timezone             SchoolTimezone @default(WIB)
  /// Menit lokal. Wajib: open < start <= close <= dayEnd < 1440.
  checkInOpenMinute    Int            @default(360) @db.SmallInt
  startMinute          Int            @default(420) @db.SmallInt
  /// Check-in setelah start + toleransi => TERLAMBAT (tetap dihitung hadir).
  lateToleranceMinutes Int            @default(15) @db.SmallInt
  checkInCloseMinute   Int            @default(600) @db.SmallInt
  /// Setelah menit ini job AUTO_ALPHA menutup hari tersebut.
  dayEndMinute         Int            @default(900) @db.SmallInt
  /// Bitmask: Sen=1 Sel=2 Rab=4 Kam=8 Jum=16 Sab=32 Min=64. 31 = Sen–Jum, 63 = Sen–Sab.
  schoolDaysMask       Int            @default(31) @db.TinyInt
  /// Rekening tujuan transfer SPP yang ditampilkan di aplikasi siswa.
  bankName             String?        @db.VarChar(50)
  bankAccountNumber    String?        @db.VarChar(30)
  bankAccountHolder    String?        @db.VarChar(100)
  /// Penunjuk semester aktif; @unique => paling banyak satu semester aktif per sekolah.
  activeTermId         String?        @unique
  isActive             Boolean        @default(true)

  province   Province @relation(fields: [provinceCode], references: [code], onDelete: Restrict)
  city       City     @relation(fields: [cityCode], references: [code], onDelete: Restrict)
  activeTerm Term?    @relation("SchoolActiveTerm", fields: [activeTermId], references: [id], onDelete: Restrict)

  terms              Term[]              @relation("SchoolTerms")
  users              User[]
  academicYears      AcademicYear[]
  classes            SchoolClass[]
  subjects           Subject[]
  holidays           Holiday[]
  students           Student[]
  reportCards        ReportCard[]
  attendances        Attendance[]
  leaveRequests      LeaveRequest[]
  invoices           Invoice[]
  paymentSubmissions PaymentSubmission[]
  payments           Payment[]
  announcements      Announcement[]
  adTargets          AdTarget[]
  adClicks           AdClick[]
  files              StoredFile[]
  auditLogs          AuditLog[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([provinceCode, cityCode])
  @@index([cityCode])
}

/// Libur / hari non-sekolah, rentang tanggal lokal inklusif.
/// schoolId NULL = libur nasional (dikelola super admin, berlaku semua sekolah).
model Holiday {
  id        String   @id @default(cuid())
  schoolId  String?
  name      String   @db.VarChar(150)
  startDate DateTime @db.Date
  endDate   DateTime @db.Date

  school School? @relation(fields: [schoolId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, startDate])
}

model AcademicYear {
  id        String   @id @default(cuid())
  schoolId  String
  /// "2025/2026"
  name      String   @db.VarChar(9)
  startDate DateTime @db.Date
  endDate   DateTime @db.Date

  school  School        @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  terms   Term[]
  classes SchoolClass[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([schoolId, name])
}

/// Semester. Label tampilan "Semester Ganjil 2025/2026" diturunkan, tidak disimpan.
model Term {
  id             String   @id @default(cuid())
  schoolId       String
  academicYearId String
  semester       Semester
  startDate      DateTime @db.Date
  endDate        DateTime @db.Date

  school          School       @relation("SchoolTerms", fields: [schoolId], references: [id], onDelete: Restrict)
  academicYear    AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Restrict)
  activeForSchool School?      @relation("SchoolActiveTerm")
  reportCards     ReportCard[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([academicYearId, semester])
  @@index([schoolId, startDate])
}

/// Rombongan belajar per tahun ajaran, mis. "X IPA 1". Nonaktifkan, jangan hapus.
model SchoolClass {
  id             String  @id @default(cuid())
  schoolId       String
  academicYearId String
  name           String  @db.VarChar(50)
  /// Tingkat 1–12.
  gradeLevel     Int     @db.TinyInt
  isActive       Boolean @default(true)

  school       School       @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  academicYear AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Restrict)

  students            Student[]
  attendances         Attendance[]
  reportCards         ReportCard[]
  announcementTargets AnnouncementTarget[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([academicYearId, name])
  @@index([schoolId, academicYearId])
}

model Subject {
  id        String  @id @default(cuid())
  schoolId  String
  code      String  @db.VarChar(20)
  name      String  @db.VarChar(100)
  /// Kriteria Ketuntasan Minimal 0–100 (di-snapshot ke nilai rapor).
  kkm       Int     @default(75) @db.TinyInt
  sortOrder Int     @default(0) @db.SmallInt
  isActive  Boolean @default(true)

  school School            @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  grades ReportCardGrade[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([schoolId, code])
}

// ===================== prisma/schema/student.prisma =====================

enum Gender {
  MALE
  FEMALE
}

/// DRAFT = akun dibuat, data wajib belum lengkap; tidak bisa login sampai diaktivasi.
enum StudentStatus {
  DRAFT
  ACTIVE
  INACTIVE
  GRADUATED
  MOVED
}

/// Pendaftaran siswa di SATU sekolah (satu baris per sekolah per NISN).
model Student {
  id             String        @id @default(cuid())
  userId         String        @unique
  schoolId       String
  nisn           String        @db.Char(10)
  /// = nisn selama pendaftaran "hidup" (DRAFT/ACTIVE/INACTIVE/GRADUATED); NULL saat MOVED
  /// atau dilepas karena NISN yang sama didaftarkan di sekolah lain (lulus SMP -> SMA).
  /// Kunci login siswa. Unik => maks. satu pendaftaran hidup per NISN secara nasional.
  activeNisn     String?       @unique @db.Char(10)
  nis            String        @db.VarChar(20)
  gender         Gender
  /// Kolom opsional di DB tetapi WAJIB sebelum aktivasi (rule murni isStudentActivatable).
  birthPlace     String?       @db.VarChar(100)
  birthDate      DateTime?     @db.Date
  address        String?       @db.Text
  guardianName   String?       @db.VarChar(100)
  guardianPhone  String?       @db.VarChar(20)
  status         StudentStatus @default(DRAFT)
  currentClassId String?
  activatedAt    DateTime?

  user         User         @relation(fields: [userId], references: [id], onDelete: Restrict)
  school       School       @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  currentClass SchoolClass? @relation(fields: [currentClassId], references: [id], onDelete: Restrict)

  attendances         Attendance[]
  leaveRequests       LeaveRequest[]
  reportCards         ReportCard[]
  invoices            Invoice[]
  paymentSubmissions  PaymentSubmission[]
  announcementTargets AnnouncementTarget[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([schoolId, nisn])
  @@unique([schoolId, nis])
  @@index([nisn])
  @@index([schoolId, status])
  @@index([currentClassId, status])
}

// ===================== prisma/schema/report-card.prisma =====================

enum ReportCardStatus {
  DRAFT
  PUBLISHED
}

enum GradePredicate {
  A
  B
  C
  D
}

/// Rapor satu siswa untuk satu semester. Siswa hanya melihat PUBLISHED.
/// Hapus keras hanya saat DRAFT (nilai ikut terhapus).
model ReportCard {
  id                String           @id @default(cuid())
  schoolId          String
  studentId         String
  termId            String
  /// Snapshot kelas saat rapor dibuat (siswa bisa naik/pindah kelas kemudian).
  classId           String
  classNameSnapshot String           @db.VarChar(50)
  status            ReportCardStatus @default(DRAFT)
  publishedAt       DateTime?
  publishedById     String?

  school      School            @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  student     Student           @relation(fields: [studentId], references: [id], onDelete: Restrict)
  term        Term              @relation(fields: [termId], references: [id], onDelete: Restrict)
  schoolClass SchoolClass       @relation(fields: [classId], references: [id], onDelete: Restrict)
  publishedBy User?             @relation(fields: [publishedById], references: [id], onDelete: Restrict)
  grades      ReportCardGrade[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId, termId])
  @@index([schoolId, termId, status])
  @@index([classId, termId])
}

model ReportCardGrade {
  id                  String         @id @default(cuid())
  reportCardId        String
  subjectId           String
  subjectNameSnapshot String         @db.VarChar(100)
  kkmSnapshot         Int            @db.TinyInt
  /// 0–100, dua desimal.
  score               Decimal        @db.Decimal(5, 2)
  /// Dihitung rule murni dari score & kkmSnapshot.
  predicate           GradePredicate
  description         String?        @db.VarChar(500)

  reportCard ReportCard @relation(fields: [reportCardId], references: [id], onDelete: Cascade)
  subject    Subject    @relation(fields: [subjectId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([reportCardId, subjectId])
  @@index([subjectId])
}

// ===================== prisma/schema/attendance.prisma =====================

enum AttendanceStatus {
  HADIR
  TERLAMBAT
  IZIN
  SAKIT
  ALPHA
}

enum AttendanceSource {
  CHECKIN
  LEAVE
  AUTO_ALPHA
  ADMIN
}

enum LeaveType {
  IZIN
  SAKIT
}

/// Satu baris per siswa per tanggal lokal sekolah. Hanya check-in (tanpa check-out).
model Attendance {
  id                 String           @id @default(cuid())
  schoolId           String
  studentId          String
  /// Snapshot kelas saat dicatat, agar rekap kelas historis tetap benar.
  classId            String?
  date               DateTime         @db.Date
  status             AttendanceStatus
  source             AttendanceSource
  /// Instant server (UTC). NULL untuk LEAVE/AUTO_ALPHA.
  checkInAt          DateTime?
  lateMinutes        Int?             @db.SmallInt
  latitude           Decimal?         @db.Decimal(10, 7)
  longitude          Decimal?         @db.Decimal(10, 7)
  accuracyM          Int?
  distanceM          Int?
  /// Flag `mocked` dari Expo Location (hanya Android yang andal).
  isMocked           Boolean?
  /// Timestamp fix GPS dari perangkat (deteksi lokasi basi/replay).
  locationCapturedAt DateTime?
  deviceId           String?          @db.VarChar(100)
  /// WAJIB untuk source CHECKIN. Unik: satu foto tidak bisa dipakai dua kali.
  selfieFileId       String?          @unique
  /// Kolom boolean agar bisa difilter/di-index (JSON di MariaDB tidak difilter).
  hasAnomaly         Boolean          @default(false)
  /// Array kode, mis. ["MOCK_LOCATION","LOW_ACCURACY","SHARED_DEVICE","STALE_FIX","CLOCK_SKEW"].
  anomalyFlags       Json?
  leaveRequestId     String?
  note               String?          @db.VarChar(255)

  school       School        @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  student      Student       @relation(fields: [studentId], references: [id], onDelete: Restrict)
  schoolClass  SchoolClass?  @relation(fields: [classId], references: [id], onDelete: Restrict)
  selfieFile   StoredFile?   @relation(fields: [selfieFileId], references: [id], onDelete: Restrict)
  leaveRequest LeaveRequest? @relation(fields: [leaveRequestId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId, date])
  @@index([schoolId, date, classId, status])
  @@index([schoolId, hasAnomaly, date])
  @@index([schoolId, date, deviceId])
  @@index([classId, date])
  @@index([leaveRequestId])
}

model LeaveRequest {
  id               String       @id @default(cuid())
  schoolId         String
  studentId        String
  type             LeaveType
  startDate        DateTime     @db.Date
  endDate          DateTime     @db.Date
  reason           String       @db.VarChar(500)
  attachmentFileId String?      @unique
  status           ReviewStatus @default(PENDING)
  reviewedById     String?
  reviewedAt       DateTime?
  reviewNote       String?      @db.VarChar(255)

  school         School       @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  student        Student      @relation(fields: [studentId], references: [id], onDelete: Restrict)
  attachmentFile StoredFile?  @relation(fields: [attachmentFileId], references: [id], onDelete: Restrict)
  reviewedBy     User?        @relation(fields: [reviewedById], references: [id], onDelete: Restrict)
  attendances    Attendance[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, status, createdAt])
  @@index([studentId, startDate])
}

// ===================== prisma/schema/billing.prisma =====================

enum InvoiceType {
  SPP
}

/// PARTIAL/PAID diturunkan rule murni dari paidAmount; "jatuh tempo" TIDAK disimpan (dueDate < hari ini).
enum InvoiceStatus {
  UNPAID
  PARTIAL
  PAID
  VOID
}

enum PaymentMethod {
  TRANSFER
  CASH
}

model Invoice {
  id          String        @id @default(cuid())
  schoolId    String
  studentId   String
  type        InvoiceType   @default(SPP)
  periodYear  Int           @db.SmallInt
  periodMonth Int           @db.TinyInt
  title       String        @db.VarChar(100)
  amount      Int
  dueDate     DateTime      @db.Date
  /// Cache Σ Payment.amount yang tidak VOID; diperbarui di transaksi yang sama (FOR UPDATE).
  paidAmount  Int           @default(0)
  status      InvoiceStatus @default(UNPAID)
  /// Kapan menjadi PAID.
  paidAt      DateTime?
  note        String?       @db.VarChar(255)
  voidedAt    DateTime?
  voidedById  String?
  voidReason  String?       @db.VarChar(255)

  school      School              @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  student     Student             @relation(fields: [studentId], references: [id], onDelete: Restrict)
  voidedBy    User?               @relation(fields: [voidedById], references: [id], onDelete: Restrict)
  submissions PaymentSubmission[]
  payments    Payment[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId, type, periodYear, periodMonth])
  @@index([schoolId, status, dueDate])
  @@index([schoolId, periodYear, periodMonth])
  @@index([studentId, status])
}

/// Bukti transfer yang diunggah siswa; admin APPROVE -> membuat tepat satu Payment.
model PaymentSubmission {
  id           String       @id @default(cuid())
  schoolId     String
  invoiceId    String
  studentId    String
  amount       Int
  transferDate DateTime     @db.Date
  senderName   String?      @db.VarChar(100)
  senderBank   String?      @db.VarChar(50)
  proofFileId  String       @unique
  note         String?      @db.VarChar(255)
  status       ReviewStatus @default(PENDING)
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?      @db.VarChar(255)

  school     School     @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  invoice    Invoice    @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  student    Student    @relation(fields: [studentId], references: [id], onDelete: Restrict)
  proofFile  StoredFile @relation(fields: [proofFileId], references: [id], onDelete: Restrict)
  reviewedBy User?      @relation(fields: [reviewedById], references: [id], onDelete: Restrict)
  payment    Payment?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, status, createdAt])
  @@index([invoiceId, status])
  @@index([studentId, createdAt])
}

/// Uang yang benar-benar diterima (transfer terverifikasi atau tunai dicatat admin).
/// Koreksi hanya lewat VOID bercatat, tidak pernah dihapus.
model Payment {
  id           String        @id @default(cuid())
  schoolId     String
  invoiceId    String
  amount       Int
  method       PaymentMethod
  paidAt       DateTime
  submissionId String?       @unique
  recordedById String
  note         String?       @db.VarChar(255)
  voidedAt     DateTime?
  voidedById   String?
  voidReason   String?       @db.VarChar(255)

  school     School             @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  invoice    Invoice            @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  submission PaymentSubmission? @relation(fields: [submissionId], references: [id], onDelete: Restrict)
  recordedBy User               @relation("PaymentRecordedBy", fields: [recordedById], references: [id], onDelete: Restrict)
  voidedBy   User?              @relation("PaymentVoidedBy", fields: [voidedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, paidAt])
  @@index([invoiceId])
}

// ===================== prisma/schema/notification.prisma =====================

/// Kategori ikon feed. SYSTEM hanya untuk notifikasi non-pengumuman (sponsor/admin).
enum NotificationCategory {
  ACADEMIC
  FINANCE
  EVENT
  CALENDAR
  STUDENT_AFFAIRS
  SYSTEM
}

enum AnnouncementAudience {
  ALL
  CLASSES
  STUDENTS
}

enum AnnouncementStatus {
  DRAFT
  SCHEDULED
  PUBLISHED
  CANCELLED
}

enum NotificationType {
  ANNOUNCEMENT
  INVOICE_ISSUED
  PAYMENT_SUBMITTED
  PAYMENT_APPROVED
  PAYMENT_REJECTED
  LEAVE_SUBMITTED
  LEAVE_APPROVED
  LEAVE_REJECTED
  REPORT_CARD_PUBLISHED
  SPONSOR_APPROVED
  SPONSOR_SUSPENDED
  AD_SUBMITTED
  AD_APPROVED
  AD_REJECTED
  TOPUP_SUBMITTED
  TOPUP_APPROVED
  TOPUP_REJECTED
  LOW_BALANCE
}

enum PushStatus {
  PENDING
  SENT
  FAILED
  SKIPPED
}

model Announcement {
  id             String               @id @default(cuid())
  schoolId       String
  authorId       String
  category       NotificationCategory
  title          String               @db.VarChar(150)
  body           String               @db.Text
  audience       AnnouncementAudience
  status         AnnouncementStatus   @default(DRAFT)
  /// Jadwal terbit (NULL = segera saat dipublikasikan).
  publishAt      DateTime?
  /// Kapan fan-out ke Notification selesai.
  publishedAt    DateTime?
  recipientCount Int?

  school        School               @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  author        User                 @relation(fields: [authorId], references: [id], onDelete: Restrict)
  targets       AnnouncementTarget[]
  notifications Notification[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([schoolId, createdAt])
  @@index([status, publishAt])
}

/// Tepat satu dari classId / studentId terisi, sesuai audience induk.
model AnnouncementTarget {
  id             String  @id @default(cuid())
  announcementId String
  classId        String?
  studentId      String?

  announcement Announcement @relation(fields: [announcementId], references: [id], onDelete: Cascade)
  schoolClass  SchoolClass? @relation(fields: [classId], references: [id], onDelete: Restrict)
  student      Student?     @relation(fields: [studentId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@unique([announcementId, classId])
  @@unique([announcementId, studentId])
  @@index([classId])
  @@index([studentId])
}

/// Inbox per pengguna (semua peran). Siswa: + push Expo; dashboard web: polling.
model Notification {
  id             String               @id @default(cuid())
  userId         String
  type           NotificationType
  category       NotificationCategory
  title          String               @db.VarChar(150)
  /// Pratinjau ≤ 500 karakter; isi penuh pengumuman dibaca dari Announcement.
  body           String               @db.VarChar(500)
  /// Payload deep link, mis. {"screen":"invoice","id":"..."}.
  data           Json?
  announcementId String?
  readAt         DateTime?
  pushStatus     PushStatus           @default(PENDING)
  pushAttempts   Int                  @default(0) @db.TinyInt
  pushedAt       DateTime?
  pushError      String?              @db.VarChar(255)

  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  announcement Announcement? @relation(fields: [announcementId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, announcementId])
  @@index([userId, createdAt])
  @@index([userId, readAt])
  @@index([pushStatus, createdAt])
}

// ===================== prisma/schema/sponsor.prisma =====================

enum SponsorStatus {
  PENDING
  APPROVED
  SUSPENDED
}

/// "Aktif" di UI = APPROVED && startAt <= now < endAt && sponsor APPROVED && saldo >= cpcAmount.
/// Mengubah gambar/link/target iklan APPROVED/PAUSED -> kembali PENDING_REVIEW.
enum AdStatus {
  DRAFT
  PENDING_REVIEW
  APPROVED
  REJECTED
  PAUSED
  ARCHIVED
}

enum AdLinkType {
  EXTERNAL_URL
  DEEP_LINK
}

enum AdTargetScope {
  ALL
  PROVINCE
  CITY
  SCHOOL
}

enum DeviceType {
  MOBILE
  TABLET
  DESKTOP
}

enum ClickBilling {
  CHARGED
  DUPLICATE
  INSUFFICIENT_BALANCE
  AD_NOT_LIVE
}

enum LedgerEntryType {
  TOPUP
  CLICK_CHARGE
  ADJUSTMENT
  REFUND
}

model Sponsor {
  id           String        @id @default(cuid())
  companyName  String        @db.VarChar(150)
  contactName  String        @db.VarChar(100)
  contactEmail String        @db.VarChar(191)
  contactPhone String        @db.VarChar(20)
  address      String?       @db.Text
  status       SponsorStatus @default(PENDING)
  statusReason String?       @db.VarChar(255)
  reviewedById String?
  reviewedAt   DateTime?
  /// Cache saldo PPC. Sumber kebenaran = ledger; selalu = balanceAfter entri seq terakhir.
  balance      Int           @default(0)

  reviewedBy    User?                @relation("SponsorReviewer", fields: [reviewedById], references: [id], onDelete: Restrict)
  members       User[]               @relation("SponsorMembers")
  ads           Ad[]
  adClicks      AdClick[]
  dailyStats    AdDailyStat[]
  ledgerEntries SponsorLedgerEntry[]
  topUpRequests TopUpRequest[]
  files         StoredFile[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
}

model Ad {
  id           String        @id @default(cuid())
  sponsorId    String
  title        String        @db.VarChar(100)
  imageFileId  String
  /// https:// (EXTERNAL_URL) atau skema aplikasi yang di-allowlist (DEEP_LINK).
  targetUrl    String        @db.VarChar(2000)
  linkType     AdLinkType
  startAt      DateTime
  endAt        DateTime
  status       AdStatus      @default(DRAFT)
  targetScope  AdTargetScope @default(ALL)
  /// Snapshot PlatformSetting.defaultCpcAmount saat diajukan; tidak berubah selama tayang.
  cpcAmount    Int
  submittedAt  DateTime?
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?       @db.VarChar(255)

  sponsor    Sponsor       @relation(fields: [sponsorId], references: [id], onDelete: Restrict)
  imageFile  StoredFile    @relation(fields: [imageFileId], references: [id], onDelete: Restrict)
  reviewedBy User?         @relation(fields: [reviewedById], references: [id], onDelete: Restrict)
  targets    AdTarget[]
  clicks     AdClick[]
  dailyStats AdDailyStat[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([sponsorId, status])
  @@index([status, startAt, endAt])
}

/// Tepat satu kolom target terisi, sesuai Ad.targetScope (tanpa baris bila ALL).
model AdTarget {
  id           String  @id @default(cuid())
  adId         String
  provinceCode String? @db.VarChar(2)
  cityCode     String? @db.VarChar(5)
  schoolId     String?

  ad       Ad        @relation(fields: [adId], references: [id], onDelete: Cascade)
  province Province? @relation(fields: [provinceCode], references: [code], onDelete: Restrict)
  city     City?     @relation(fields: [cityCode], references: [code], onDelete: Restrict)
  school   School?   @relation(fields: [schoolId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@unique([adId, provinceCode])
  @@unique([adId, cityCode])
  @@unique([adId, schoolId])
  @@index([provinceCode])
  @@index([cityCode])
  @@index([schoolId])
}

/// Klik mentah (setiap klik dicatat; hanya yang CHARGED memotong saldo).
model AdClick {
  id           String       @id @default(cuid())
  adId         String
  sponsorId    String
  userId       String
  schoolId     String
  /// Snapshot wilayah sekolah saat klik (breakdown provinsi). Tanpa FK, sengaja.
  provinceCode String       @db.VarChar(2)
  cityCode     String       @db.VarChar(5)
  deviceType   DeviceType
  /// Hari analitik (Asia/Jakarta).
  date         DateTime     @db.Date
  billing      ClickBilling
  chargeAmount Int          @default(0)
  /// = date bila billing = CHARGED, selain itu NULL => maks. satu tagihan per siswa/iklan/hari.
  billableDate DateTime?    @db.Date

  ad          Ad                  @relation(fields: [adId], references: [id], onDelete: Restrict)
  sponsor     Sponsor             @relation(fields: [sponsorId], references: [id], onDelete: Restrict)
  user        User                @relation(fields: [userId], references: [id], onDelete: Restrict)
  school      School              @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  ledgerEntry SponsorLedgerEntry?

  createdAt DateTime @default(now())

  @@unique([adId, userId, billableDate])
  @@index([adId, date, userId])
  @@index([sponsorId, date, userId])
}

/// Rollup harian per iklan (hari Asia/Jakarta). Impresi HANYA ada di sini (tanpa tabel mentah).
/// Diperbarui atomik: INSERT ... ON DUPLICATE KEY UPDATE col = col + ?.
model AdDailyStat {
  adId          String
  date          DateTime @db.Date
  sponsorId     String
  impressions   Int      @default(0)
  clicks        Int      @default(0)
  uniqueClicks  Int      @default(0)
  chargedClicks Int      @default(0)
  spend         Int      @default(0)

  ad      Ad      @relation(fields: [adId], references: [id], onDelete: Restrict)
  sponsor Sponsor @relation(fields: [sponsorId], references: [id], onDelete: Restrict)

  updatedAt DateTime @default(now()) @updatedAt

  @@id([adId, date])
  @@index([sponsorId, date])
}

/// Buku besar saldo sponsor, append-only. Semua mutasi saldo: kunci Sponsor FOR UPDATE,
/// tulis entri seq+1, set Sponsor.balance = balanceAfter — dalam satu transaksi.
model SponsorLedgerEntry {
  id             String          @id @default(cuid())
  sponsorId      String
  seq            Int
  type           LedgerEntryType
  /// Bertanda: + kredit, − debit.
  amount         Int
  balanceAfter   Int
  topUpRequestId String?         @unique
  adClickId      String?         @unique
  note           String?         @db.VarChar(255)
  /// NULL untuk potongan klik otomatis.
  createdById    String?

  sponsor      Sponsor       @relation(fields: [sponsorId], references: [id], onDelete: Restrict)
  topUpRequest TopUpRequest? @relation(fields: [topUpRequestId], references: [id], onDelete: Restrict)
  adClick      AdClick?      @relation(fields: [adClickId], references: [id], onDelete: Restrict)
  createdBy    User?         @relation(fields: [createdById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@unique([sponsorId, seq])
  @@index([sponsorId, createdAt])
}

model TopUpRequest {
  id           String       @id @default(cuid())
  sponsorId    String
  amount       Int
  transferDate DateTime     @db.Date
  senderName   String       @db.VarChar(100)
  senderBank   String       @db.VarChar(50)
  proofFileId  String       @unique
  note         String?      @db.VarChar(255)
  status       ReviewStatus @default(PENDING)
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?      @db.VarChar(255)

  sponsor     Sponsor             @relation(fields: [sponsorId], references: [id], onDelete: Restrict)
  proofFile   StoredFile          @relation(fields: [proofFileId], references: [id], onDelete: Restrict)
  reviewedBy  User?               @relation(fields: [reviewedById], references: [id], onDelete: Restrict)
  ledgerEntry SponsorLedgerEntry?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status, createdAt])
  @@index([sponsorId, createdAt])
}

// ===================== prisma/schema/platform.prisma =====================

enum FileKind {
  AD_BANNER
  ATTENDANCE_SELFIE
  PAYMENT_PROOF
  TOPUP_PROOF
  LEAVE_ATTACHMENT
}

enum JobRunStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

/// Singleton (id = 1), dibuat oleh migrasi.
model PlatformSetting {
  id                 Int     @id @default(1)
  defaultCpcAmount   Int
  minTopUpAmount     Int
  /// Rekening tujuan top-up yang ditampilkan ke sponsor.
  topUpBankName      String? @db.VarChar(50)
  topUpAccountNumber String? @db.VarChar(30)
  topUpAccountHolder String? @db.VarChar(100)

  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
}

/// Metadata berkas di disk (di luar direktori aplikasi). Publik hanya AD_BANNER;
/// sisanya disajikan lewat route berotorisasi. Gambar di-re-encode (sharp) sebelum disimpan.
model StoredFile {
  id           String   @id @default(cuid())
  kind         FileKind
  storageKey   String   @unique @db.VarChar(255)
  mimeType     String   @db.VarChar(100)
  sizeBytes    Int
  /// Hash hasil re-encode; bukti transfer kembar = sinyal penipuan.
  sha256       String   @db.Char(64)
  originalName String?  @db.VarChar(255)
  /// Cakupan otorisasi: pemilik tenant berkas privat.
  schoolId     String?
  sponsorId    String?
  uploadedById String

  school     School?  @relation(fields: [schoolId], references: [id], onDelete: Restrict)
  sponsor    Sponsor? @relation(fields: [sponsorId], references: [id], onDelete: Restrict)
  uploadedBy User     @relation(fields: [uploadedById], references: [id], onDelete: Restrict)

  attendance        Attendance?
  leaveRequest      LeaveRequest?
  paymentSubmission PaymentSubmission?
  topUpRequest      TopUpRequest?
  ads               Ad[]

  createdAt DateTime @default(now())

  @@index([schoolId, kind])
  @@index([sponsorId, kind])
  @@index([uploadedById])
  @@index([sha256])
}

/// Append-only. before/after tanpa data rahasia (hash password, token).
model AuditLog {
  id         String    @id @default(cuid())
  actorId    String?
  actorRole  UserRole?
  schoolId   String?
  /// mis. "student.activate", "invoice.void", "topup.approve"
  action     String    @db.VarChar(64)
  entityType String    @db.VarChar(40)
  entityId   String    @db.VarChar(191)
  before     Json?
  after      Json?
  ipAddress  String?   @db.VarChar(45)
  userAgent  String?   @db.VarChar(255)

  actor  User?   @relation(fields: [actorId], references: [id], onDelete: Restrict)
  school School? @relation(fields: [schoolId], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@index([entityType, entityId, createdAt])
  @@index([schoolId, createdAt])
  @@index([actorId, createdAt])
}

/// Penanda idempotensi + mutex job cron, mis. ("auto-alpha", <schoolId>, "2026-09-21").
model JobRun {
  id         String       @id @default(cuid())
  job        String       @db.VarChar(64)
  scopeKey   String       @db.VarChar(64)
  runKey     String       @db.VarChar(32)
  status     JobRunStatus
  startedAt  DateTime     @default(now())
  finishedAt DateTime?
  result     Json?
  error      String?      @db.Text

  updatedAt DateTime @updatedAt

  @@unique([job, scopeKey, runKey])
}
```

## 2. Key invariants and why each unique or index exists

### Deviations from the lead's defaults
1. **NISN is not globally `@unique` on Student.** One installation serves many schools, so the same student will enrol in more than one of them (SD→SMP→SMA, or a transfer). A global unique would block the second school from registering them, or force moving history between tenants. The replacement:
   - `@@unique([schoolId, nisn])`: one enrolment row per school.
   - `activeNisn @unique` (nullable): at most one live enrolment nationally. This is also the login key.
   - When a new school enrols a NISN, the service releases `activeNisn` from an old GRADUATED or MOVED row. If the old row is ACTIVE, it returns 409.
2. **No raw impression table.** A row per impression would reach hundreds of thousands of rows a day. No screen needs impression-level detail: "Total Tayang" and CTR only need daily totals. Impressions are counted only in `AdDailyStat` (throttled per user and ad, in memory). Clicks are stored raw because they cost money and are needed for unique counts and device/province breakdowns. If raw impressions are required, the fallback is `AdImpression @@unique([adId,userId,date]) + count`.
3. **The push token lives on `AuthSession`**, not in a separate device table. Logging out or revoking a session then stops pushes to that phone, and one phone can never receive another account's notifications. It is also one table fewer.
4. **Times of day are stored as minutes (SmallInt), not `@db.Time`.** Prisma reads TIME as a DateTime pinned to 1970, which invites timezone bugs.
5. **Convention exceptions:**
   - Append-only rows have no `updatedAt`.
   - `AdDailyStat` uses a composite primary key so a single atomic `ON DUPLICATE KEY UPDATE` can update it.
   - `PlatformSetting` is a single row with `id = 1`.
6. **Tenant isolation stays in the service layer, as the lead chose.** I rejected composite (id, schoolId) foreign keys: Prisma's SetNull would also null the schoolId, and they add a lot of boilerplate. The rule "child.schoolId = parent.schoolId" needs tests in every service.

### Auth
- `User.email @unique`: the collation is case-insensitive, so one account per email. Students log in by NISN via `Student.activeNisn @unique`.
- `RefreshToken.tokenHash @unique` stores only a SHA-256 hash of the token.
  - Rotation marks the old token with a compare-and-set (`updateMany where rotatedAt IS NULL`).
  - A token that already has `rotatedAt` set means reuse: the whole `AuthSession` (the token family) is revoked with `TOKEN_REUSE`.
- `User.tokenVersion` is checked in the same per-request user lookup as `isActive`. Bumping it kills access tokens immediately after a password change or deactivation.
- `AuthSession [userId, revokedAt]` lists a user's live sessions (logout everywhere). `[expiresAt]` is for the cleanup job.

### School and academic
- `School.activeTermId @unique` points to the active term, so a school has at most one active term by construction.
- `Term [academicYearId, semester]`, `AcademicYear [schoolId, name]`, `SchoolClass [academicYearId, name]` and `Subject [schoolId, code]` each stop duplicate reference rows.
- Student indexes:
  - `[schoolId, nis]`: NIS is unique within a school.
  - `[schoolId, status]`: the "Total Siswa aktif/nonaktif" card.
  - `[currentClassId, status]`: the class filter.
  - `[nisn]`: finds a student's enrolments across schools.
- `ReportCard [studentId, termId]` gives one report card per term. `ReportCardGrade [reportCardId, subjectId]` gives one grade per subject.
- Report cards store snapshots of class name, subject name and KKM, so a published report card never changes later. `[schoolId, termId, status]` feeds the "Nilai Raport semester ini" card.

### Attendance
- `[studentId, date]` allows one record per student per local date.
  - A double-tap check-in hits P2002 and returns 409.
  - `AUTO_ALPHA` uses `createMany skipDuplicates`, so it is safe to re-run.
  - The same index serves the student's attendance history.
- `[schoolId, date, classId, status]` is covering: it answers "Kehadiran Hari Ini %", the check-in map, and the monthly per-class recap without reading the table.
- `[schoolId, hasAnomaly, date]` lists anomalies. `[schoolId, date, deviceId]` finds one phone checking in several students.
- `[classId, date]` is the single-class drill-down and trend.
- `selfieFileId @unique` means one photo cannot be reused for another check-in.
- Anomalies are never filtered on the JSON column (MariaDB JSON is LONGTEXT), so there is a separate boolean.
- Approving a leave upserts `source=LEAVE` rows for school days only (holidays and the weekday mask are skipped). It overwrites `AUTO_ALPHA` rows but not an existing CHECKIN row; see open question 3.
- `JobRun [job, scopeKey, runKey]` runs each job once per (job, school, local date) and stops overlapping cron runs.

### Billing
- `Invoice [studentId, type, periodYear, periodMonth]` prevents billing SPP twice for the same month; bulk generation uses `skipDuplicates`. A VOID invoice keeps its slot, so re-billing means un-voiding or editing it.
- `paidAmount` always equals the sum of non-void payments. Status comes from a pure function. Both are updated in the same transaction under `FOR UPDATE` on the invoice.
- `[schoolId, status, dueDate]` feeds the "belum lunas" card and the overdue list.
- `Payment.submissionId @unique`: approving a submission twice still creates only one payment. Every review is a compare-and-set (`updateMany where status=PENDING`).
- `PaymentSubmission [schoolId, status, createdAt]` is the admin verification queue.
- `StoredFile [sha256]` catches the same transfer proof being submitted twice.

### Notifications
- `Notification [userId, announcementId]` makes fan-out safe to retry.
- `[userId, createdAt]` is the feed, `[userId, readAt]` the unread badge, `[pushStatus, createdAt]` the push worker's queue.
- `Announcement [status, publishAt]` lets the scheduler find SCHEDULED announcements that are due.

### Ads and money
- `Sponsor.balance` equals the last ledger `balanceAfter`.
  - `Ledger [sponsorId, seq] @unique` makes two concurrent appends collide instead of silently losing an update.
  - Every balance change locks the sponsor row `FOR UPDATE`.
- `Ledger.topUpRequestId @unique` credits a top-up only once. `adClickId @unique` charges a click only once.
- `AdClick [adId, userId, billableDate]` allows at most one CHARGED click per student, per ad, per day at database level. Repeat clicks are stored as DUPLICATE and cost nothing.
- `AdClick [sponsorId, date, userId]` and `[adId, date, userId]` are covering indexes for "Klik Unik" (a distinct count over any date range, which daily rollups cannot give) and for the device and province breakdowns. The first also serves the "first click today" check that updates `uniqueClicks`.
- `AdDailyStat` (key `[adId, date]`, index `[sponsorId, date]`) feeds the KPIs, the 7/30-day chart, the top-3 ads and the change vs the previous period.
- `Ad [status, startAt, endAt]` serves live ads and the review queue.
- `AdTarget` uniques stop duplicate targeting rows. Its reverse indexes find ads targeting a given school, city or province.
- `Ad.cpcAmount` is a snapshot, so changing the default CPC does not reprice live ads.

### Recommended raw SQL CHECK constraints (init migration)
Prisma cannot declare CHECK constraints. MariaDB 10.11 enforces them; verify each one in CI.
- User role/scope matrix (which of schoolId and sponsorId each role must have).
- `Sponsor.balance >= 0`.
- Invoice: `amount > 0`, `0 <= paidAmount <= amount`, month between 1 and 12.
- Grade `score` between 0 and 100.
- School time order `open < start <= close <= dayEnd < 1440`, and radius > 0.
- `startDate <= endDate` on Holiday, Term, AcademicYear and LeaveRequest; `startAt < endAt` on Ad.
- Exactly one target column filled on AdTarget and AnnouncementTarget.
- Ledger `amount <> 0` and `balanceAfter >= 0`.
- `(billing='CHARGED') = (billableDate IS NOT NULL AND chargeAmount > 0)`.

### Operational notes
- Run PM2 with `TZ=UTC`, and add an integration test that writes and reads back `@db.Date` and DATETIME through the MariaDB adapter.
- Keep the storage root outside the repo (e.g. `/www/wwwroot/studenthub-storage`) and include it in backups. The lims schema itself warns that files inside the repo are lost on every deploy (`git reset --hard`).
- Seed `Province`/`City` and `PlatformSetting` through migrations.

## 3. Open questions
1. **Graduated students:** can they still log in to see history? The default above is yes, until the same NISN is enrolled at another school.
2. **Mocked GPS location:** reject the check-in, or accept it and flag it? The default is accept and flag. Expo's `mocked` flag is only reliable on Android.
3. **Approved leave on a day already checked in:** keep HADIR/TERLAMBAT (the default) or overwrite it? Also, how many days back may a leave request go?
4. **Leave attachments:** is one required for SAKIT? Are PDFs allowed? sharp cannot re-encode PDFs, so allowing them needs a separate sanitising path.
5. **Click billing dedupe window:** once per student, per ad, per day (the default)? Also, what impression throttle window counts as one "tayang"?
6. **Timezone for sponsor analytics days:** WIB (the default) for all sponsors?
7. **Meaning of `REFUND`:** a credit for invalid clicks, or paying remaining balance back to the sponsor (a debit)?
8. **"dari total Rp 2.000.000":** is the total all approved top-ups ever, or something else?
9. **Invoices:**
   - Are fee types other than SPP needed (uang gedung, seragam)?
   - Are partial payments allowed? PARTIAL is modelled but can be switched off in the rules.
   - Are human-readable invoice numbers needed for bank reconciliation?
10. **School-admin sub-roles:** do schools need them (e.g. treasurer only for SPP, operator only for attendance)? The current design is a fixed enum with no sub-scope.
11. **Sponsor sign-up:** can sponsors register themselves? That needs a public sign-up and a REJECTED status. Or does only the Super Admin create sponsor accounts (the current design)?
12. **Geofences:** can a school have more than one (several campuses)? The current design has one point and one radius.
13. **Selfie retention (minors, personal-data law UU PDP):** how long are selfies kept? The proposal is to delete the file after N days and keep the attendance row.
14. **Report card scope:**
    - Kurikulum Merdeka replaces KKM with KKTP. Are predicate thresholds fixed or relative to KKM?
    - Does the report card need a homeroom-teacher note, a sick/permission/absent count and extracurricular sections?
