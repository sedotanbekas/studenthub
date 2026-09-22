-- P5 TOTP super admin: langkah TOTP terakhir yang diterima (anti-replay kode yang sama).
-- Aditif saja: kolom nullable baru, tanpa DROP/MODIFY/RENAME pada tabel terpakai.
ALTER TABLE `User` ADD COLUMN `totpLastUsedStep` INTEGER NULL;
