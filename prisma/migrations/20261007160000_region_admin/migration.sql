-- Admin Pemerintah Daerah (REGION_ADMIN, permintaan pemilik 2026-10-07): memantau (BACA saja) sekolah di provinsinya,
-- atau di satu kabupaten/kota. Aditif saja:
-- 1) Nilai enum REGION_ADMIN ditambahkan di UJUNG UserRole pada ketiga kolom pemakainya (MariaDB: tambah nilai di
--    ujung ENUM = perubahan metadata instan, baris lama tidak disentuh).
-- 2) User: kolom nullable regionProvinceCode/regionCityCode + FK + indeks, dan CHECK chk_user_scope DILONGGARKAN
--    (DROP + ADD bernama sama dalam satu ALTER; pengecualian yang disetujui pemilik 2026-09-30): semua baris lama
--    (wilayah NULL) dan kode lama tetap memenuhi syarat baru; perbandingan nullable memakai <=>.
-- 3) Peran sistem "pemda" (data referensi produksi) dicentang persis hak bawaan POLICY untuk REGION_ADMIN.

ALTER TABLE `AccessRole` MODIFY `baseRole` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'SPONSOR', 'STUDENT', 'REGION_ADMIN') NOT NULL;

ALTER TABLE `AuditLog` MODIFY `actorRole` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'SPONSOR', 'STUDENT', 'REGION_ADMIN') NULL;

ALTER TABLE `User`
  MODIFY `role` ENUM('SUPER_ADMIN', 'SCHOOL_ADMIN', 'SPONSOR', 'STUDENT', 'REGION_ADMIN') NOT NULL,
  ADD COLUMN `regionProvinceCode` VARCHAR(2) NULL,
  ADD COLUMN `regionCityCode` VARCHAR(5) NULL,
  ADD INDEX `User_regionProvinceCode_regionCityCode_idx` (`regionProvinceCode`, `regionCityCode`),
  ADD INDEX `User_regionCityCode_idx` (`regionCityCode`),
  ADD CONSTRAINT `User_regionProvinceCode_fkey` FOREIGN KEY (`regionProvinceCode`) REFERENCES `Province`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `User_regionCityCode_fkey` FOREIGN KEY (`regionCityCode`) REFERENCES `City`(`code`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CONSTRAINT `chk_user_scope`,
  ADD CONSTRAINT `chk_user_scope` CHECK (
    (
      (`role` = 'SUPER_ADMIN' AND `schoolId` IS NULL AND `sponsorId` IS NULL AND `email` IS NOT NULL)
      OR (`role` = 'SCHOOL_ADMIN' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND (`email` IS NOT NULL OR `primarySchoolId` <=> `schoolId`))
      OR (`role` = 'SPONSOR' AND `sponsorId` IS NOT NULL AND `schoolId` IS NULL AND `email` IS NOT NULL)
      OR (`role` = 'STUDENT' AND `schoolId` IS NOT NULL AND `sponsorId` IS NULL AND `email` IS NULL)
      OR (`role` = 'REGION_ADMIN' AND `schoolId` IS NULL AND `sponsorId` IS NULL AND `email` IS NOT NULL AND `regionProvinceCode` IS NOT NULL)
    )
    AND (`primarySchoolId` IS NULL OR (`role` = 'SCHOOL_ADMIN' AND `primarySchoolId` <=> `schoolId`))
    AND ((`regionProvinceCode` IS NULL AND `regionCityCode` IS NULL) OR `role` = 'REGION_ADMIN')
    AND (`regionCityCode` IS NULL OR LEFT(`regionCityCode`, 2) <=> `regionProvinceCode`)
  );

-- Peran sistem Admin Pemda
INSERT INTO `AccessRole` (`id`, `key`, `name`, `description`, `baseRole`, `isSystem`, `permissions`, `knownActions`, `createdAt`, `updatedAt`) VALUES
  ('role_pemda', 'pemda', 'Admin Pemda', 'Pemerintah daerah: memantau (baca saja) sekolah di provinsi/kabupaten/kota wilayahnya.', 'REGION_ADMIN', true,
   '["auth.self","auth.account","notification.self","file.read","region.read","region.monitor","schools.profile.read","calendar.read","academics.read","students.read","notification.push","attendance.monitor","reportCards.read","billing.read","announcements.read","dashboard.read"]',
   '["auth.self","auth.account","notification.self","file.read","region.read","region.monitor","schools.profile.read","calendar.read","academics.read","students.read","notification.push","attendance.monitor","reportCards.read","billing.read","announcements.read","dashboard.read"]',
   CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
