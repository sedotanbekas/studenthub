-- Radius geofence sekolah bebas diatur (permintaan pemilik 2026-10-08): batas atas 1000 m dihapus.
-- CHECK chk_school_radius DILONGGARKAN (DROP + ADD bernama sama dalam satu ALTER; pengecualian yang disetujui
-- pemilik 2026-09-30): semua baris lama (50..1000) dan kode lama tetap memenuhi syarat baru. Batas atas kini
-- hanya tipe kolom SMALLINT (32767 m), sama dengan GEOFENCE_RADIUS_MAX_M di src/lib/schools/rules.ts.

ALTER TABLE `School`
  DROP CONSTRAINT `chk_school_radius`,
  ADD CONSTRAINT `chk_school_radius` CHECK (`geofenceRadiusM` >= 50);
