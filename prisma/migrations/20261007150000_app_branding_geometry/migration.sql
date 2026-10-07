-- Logo unggahan menggantikan SEMUA logo (pemilik 2026-10-07), termasuk bentuk masker animasi splash. Aditif saja:
-- kolom JSON nullable {ox, oy, inscribed} = titik terdalam siluet logo & jari-jari lingkaran dalamnya (pecahan sisi
-- kanvas splash), dihitung saat logo diunggah. NULL = tanpa logo unggahan (splash memakai tanda "S + toga" bawaan).
ALTER TABLE `AppBranding`
  ADD COLUMN `logoGeometry` JSON NULL;
