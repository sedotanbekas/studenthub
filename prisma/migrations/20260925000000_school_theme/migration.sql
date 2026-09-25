-- Tema warna per sekolah (primer, sekunder, banner, animasi, logo) + kunci preset opsional.
-- Aditif saja: kolom nullable baru di tabel School (MariaDB 10.11: ADD COLUMN instan, tanpa backfill),
-- tidak ada perubahan/penghapusan kolom lama. NULL semua = tema bawaan aplikasi.
ALTER TABLE `School`
  ADD COLUMN `themePreset` VARCHAR(32) NULL,
  ADD COLUMN `themePrimaryColor` CHAR(7) NULL,
  ADD COLUMN `themeSecondaryColor` CHAR(7) NULL,
  ADD COLUMN `themeBannerColor` CHAR(7) NULL,
  ADD COLUMN `themeAnimationColor` CHAR(7) NULL,
  ADD COLUMN `themeLogoColor` CHAR(7) NULL,
  ADD COLUMN `themeUpdatedAt` DATETIME(3) NULL;

-- Palet diisi semua atau kosong semua (preset ikut kosong). Warna selalu `#rrggbb` huruf kecil
-- (aplikasi menormalkan); `(?-i)` membuat REGEXP peka huruf walau kolasi tabel _ci. COALESCE
-- mencegah hasil NULL (CHECK yang bernilai NULL dianggap lolos).
ALTER TABLE `School` ADD CONSTRAINT `chk_school_theme` CHECK (
  (`themePrimaryColor` IS NULL AND `themeSecondaryColor` IS NULL AND `themeBannerColor` IS NULL
    AND `themeAnimationColor` IS NULL AND `themeLogoColor` IS NULL AND `themePreset` IS NULL)
  OR (COALESCE(`themePrimaryColor`, '') REGEXP '(?-i)^#[0-9a-f]{6}$'
    AND COALESCE(`themeSecondaryColor`, '') REGEXP '(?-i)^#[0-9a-f]{6}$'
    AND COALESCE(`themeBannerColor`, '') REGEXP '(?-i)^#[0-9a-f]{6}$'
    AND COALESCE(`themeAnimationColor`, '') REGEXP '(?-i)^#[0-9a-f]{6}$'
    AND COALESCE(`themeLogoColor`, '') REGEXP '(?-i)^#[0-9a-f]{6}$')
);
