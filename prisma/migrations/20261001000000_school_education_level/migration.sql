-- Jenjang sekolah (SD/MI, SMP/MTs, SMA/MA, SMK/MAK). Aditif saja: kolom ENUM nullable baru di tabel School
-- (MariaDB 10.11: ADD COLUMN instan, tanpa backfill). NULL = belum diisi; sekolah lama mengisinya lewat
-- wizard Akademik. SchoolClass.gradeLevel tetap kelas nasional 1..12 (tidak diubah).
ALTER TABLE `School`
  ADD COLUMN `educationLevel` ENUM('SD', 'MI', 'SMP', 'MTS', 'SMA', 'MA', 'SMK', 'MAK') NULL;
