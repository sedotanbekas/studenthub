-- Data keluarga & kontak siswa: nomor HP siswa, data ayah & ibu (nama, pekerjaan, nomor HP), dan
-- pekerjaan wali. Aditif saja: kolom nullable baru di tabel Student (MariaDB 10.11: ADD COLUMN instan,
-- tanpa backfill); kolom lama tidak diubah. Nomor HP dinormalkan aplikasi ke "+628..." (tanpa CHECK,
-- sama seperti guardianPhone).
ALTER TABLE `Student`
  ADD COLUMN `phone` VARCHAR(20) NULL,
  ADD COLUMN `fatherName` VARCHAR(100) NULL,
  ADD COLUMN `fatherOccupation` VARCHAR(100) NULL,
  ADD COLUMN `fatherPhone` VARCHAR(20) NULL,
  ADD COLUMN `motherName` VARCHAR(100) NULL,
  ADD COLUMN `motherOccupation` VARCHAR(100) NULL,
  ADD COLUMN `motherPhone` VARCHAR(20) NULL,
  ADD COLUMN `guardianOccupation` VARCHAR(100) NULL;
