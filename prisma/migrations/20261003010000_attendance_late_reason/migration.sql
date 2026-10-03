-- Alasan terlambat siswa (keputusan pemilik 2026-10-03, A1). Aditif saja: tiga kolom nullable baru di
-- Attendance + satu CHECK baru; kolom & constraint lama tidak disentuh. Diisi siswa lewat
-- PUT /student/attendance/today/late-reason hanya untuk baris CHECKIN berstatus TERLAMBAT pada hari yang sama;
-- absen TIDAK PERNAH ditolak karena alasan kosong. Koreksi admin tidak menghapus alasan (tidak dihitung bila
-- status bukan TERLAMBAT). Nilai enum baru WAJIB di ujung daftar dan tidak pernah diganti nama.
-- ADD COLUMN nullable instan di MariaDB 10.11; ADD CONSTRAINT menyalin ulang tabel (Attendance masih kecil) —
-- deploy di luar jendela absen 06.00–10.00 lokal.

ALTER TABLE `Attendance`
  ADD COLUMN `lateReasonCategory` ENUM('TRANSPORT', 'WEATHER', 'OVERSLEPT', 'FAMILY', 'HEALTH', 'OTHER') NULL,
  ADD COLUMN `lateReasonNote` VARCHAR(200) NULL,
  ADD COLUMN `lateReasonAt` DATETIME(3) NULL;

-- NULL pada CHECK = lolos, jadi setiap cabang ditulis eksplisit IS [NOT] NULL.
ALTER TABLE `Attendance` ADD CONSTRAINT `chk_attendance_late_reason` CHECK (
  (`lateReasonCategory` IS NULL AND `lateReasonNote` IS NULL AND `lateReasonAt` IS NULL)
  OR (`lateReasonCategory` IS NOT NULL AND `lateReasonAt` IS NOT NULL
      AND (`lateReasonCategory` <> 'OTHER' OR (`lateReasonNote` IS NOT NULL AND CHAR_LENGTH(`lateReasonNote`) >= 5)))
);
