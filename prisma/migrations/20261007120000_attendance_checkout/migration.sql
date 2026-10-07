-- Absen pulang siswa (permintaan pemilik 2026-10-07). Aditif saja: tidak ada kolom/indeks/constraint lama yang
-- diubah atau dihapus.
-- 1) Attendance: 7 kolom nullable checkOut* + indeks unik & FK selfie pulang + CHECK chk_attendance_checkout, dalam SATU
--    ALTER agar tabel hanya dibangun ulang sekali (FK & CHECK memaksa ALGORITHM=COPY di MariaDB 10.11) — merge ke master
--    hanya 03:00–20:00 UTC (di luar jendela absen WIB–WIT). Baris lama: semua NULL = belum absen pulang (lolos CHECK).
-- 2) School: checkOutOpenMinute ber-DEFAULT 840 (14:00 lokal, instan) + CHECK rentang chk_school_checkout_open (tabel
--    School kecil). Urutan terhadap jam masuk (startMinute < checkOutOpenMinute) hanya diperiksa aplikasi
--    (validateSchoolConfig) agar sekolah lama dengan jadwal siang tidak menggagalkan migrasi; chk_school_schedule tidak disentuh.
-- Selfie pulang memakai FileKind ATTENDANCE_SELFIE yang sudah ada (retensi 180 hari & akses admin sekolah sama).

ALTER TABLE `Attendance`
  ADD COLUMN `checkOutAt` DATETIME(3) NULL,
  ADD COLUMN `checkOutLatitude` DECIMAL(10, 7) NULL,
  ADD COLUMN `checkOutLongitude` DECIMAL(10, 7) NULL,
  ADD COLUMN `checkOutAccuracyM` INTEGER NULL,
  ADD COLUMN `checkOutDistanceM` INTEGER NULL,
  ADD COLUMN `checkOutDeviceId` VARCHAR(100) NULL,
  ADD COLUMN `checkOutSelfieFileId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Attendance_checkOutSelfieFileId_key`(`checkOutSelfieFileId`),
  ADD CONSTRAINT `Attendance_checkOutSelfieFileId_fkey` FOREIGN KEY (`checkOutSelfieFileId`) REFERENCES `StoredFile`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- NULL pada CHECK = lolos, jadi setiap cabang ditulis eksplisit IS [NOT] NULL.
  ADD CONSTRAINT `chk_attendance_checkout` CHECK (
    (`checkOutAt` IS NULL AND `checkOutLatitude` IS NULL AND `checkOutLongitude` IS NULL AND `checkOutSelfieFileId` IS NULL)
    OR (`checkOutAt` IS NOT NULL AND `checkInAt` IS NOT NULL AND `checkOutLatitude` IS NOT NULL
        AND `checkOutLongitude` IS NOT NULL AND `checkOutSelfieFileId` IS NOT NULL)
  );

ALTER TABLE `School` ADD COLUMN `checkOutOpenMinute` SMALLINT NOT NULL DEFAULT 840, ALGORITHM=INSTANT;

ALTER TABLE `School` ADD CONSTRAINT `chk_school_checkout_open` CHECK (`checkOutOpenMinute` BETWEEN 1 AND 1439);
