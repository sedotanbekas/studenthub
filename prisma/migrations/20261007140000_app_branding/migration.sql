-- Identitas aplikasi (menu Pengaturan aplikasi, permintaan pemilik 2026-10-07): nama & logo aplikasi yang tampil di
-- sidebar, halaman masuk, splash, dan judul tab. Aditif saja: tabel baru + satu baris referensi (id = 1) berisi
-- nama bawaan "Student Hub" tanpa logo (= logo bawaan /brand/mark.webp), sehingga tampilan tidak berubah sampai
-- super admin mengubahnya. Logo disimpan sebagai WebP kecil (<= 256 px) di kolom MEDIUMBLOB.

-- CreateTable
CREATE TABLE `AppBranding` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `appName` VARCHAR(40) NOT NULL,
    `logo` MEDIUMBLOB NULL,
    `logoMimeType` VARCHAR(30) NULL,
    `logoUpdatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Baris tunggal (data referensi produksi).
INSERT INTO `AppBranding` (`id`, `appName`, `createdAt`, `updatedAt`) VALUES (1, 'Student Hub', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));
