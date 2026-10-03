-- Tinjau anomali absensi (keputusan pemilik 2026-10-03, B1): admin menandai catatan beranomali Valid / Tidak valid.
-- Aditif saja: enum baru + 4 kolom nullable + 1 indeks + 1 FK + 1 CHECK di Attendance; tidak ada kolom/indeks lama
-- yang diubah atau dihapus. Satu ALTER agar tabel hanya dibangun ulang sekali (FK & CHECK memaksa ALGORITHM=COPY
-- di MariaDB 10.11) — merge ke master hanya 03:00–20:00 UTC (di luar jendela absen WIB–WIT). Baris lama: semua NULL =
-- belum ditinjau. Tidak valid = koreksi menjadi ALPHA (sumber ADMIN) dalam transaksi yang sama; flag anomali tidak
-- pernah dihapus. Indeks FK anomalyReviewedById dibuat InnoDB otomatis (sama seperti LeaveRequest_reviewedById_fkey).
ALTER TABLE `Attendance`
  ADD COLUMN `anomalyReviewDecision` ENUM('VALID', 'INVALID') NULL,
  ADD COLUMN `anomalyReviewedAt` DATETIME(3) NULL,
  ADD COLUMN `anomalyReviewedById` VARCHAR(191) NULL,
  ADD COLUMN `anomalyReviewNote` VARCHAR(255) NULL,
  ADD INDEX `Attendance_schoolId_hasAnomaly_anomalyReviewedAt_date_idx`(`schoolId`, `hasAnomaly`, `anomalyReviewedAt`, `date`),
  ADD CONSTRAINT `Attendance_anomalyReviewedById_fkey` FOREIGN KEY (`anomalyReviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `chk_attendance_anomaly_review` CHECK (
    (`anomalyReviewDecision` IS NULL AND `anomalyReviewedAt` IS NULL AND `anomalyReviewedById` IS NULL AND `anomalyReviewNote` IS NULL)
    OR (`anomalyReviewDecision` IS NOT NULL AND `anomalyReviewedAt` IS NOT NULL AND `anomalyReviewedById` IS NOT NULL
        AND `hasAnomaly` = 1 AND (`anomalyReviewDecision` <=> 'VALID' OR `anomalyReviewNote` IS NOT NULL))
  );
