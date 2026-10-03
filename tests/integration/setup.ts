/**
 * Dimuat sebelum setiap berkas test integrasi (lihat script test:int): mode test menyalakan
 * validasi respons terhadap kontrak di pipeline defineRoute.
 * DEFER_MODE=inline: pekerjaan ctx.defer (mis. kick push dispatch setelah notifikasi) dijalankan
 * langsung, karena `after()` Next.js butuh request scope yang tidak ada saat route dipanggil dari test.
 * Kunci VAPID Web Push (N3): pasangan tetap KHUSUS TEST, bukan rahasia (sama dengan env CI). Dengan
 * PUSH_TRANSPORT=memory, Web Push memakai transport memori.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
env.DEFER_MODE ??= "inline";
env.VAPID_PUBLIC_KEY ??= "BDHsMb5mUv8hdwi3QYmi_kfIdZ4gftGar1_SefZ9SlslFZcDT_NbsnLFLTczHnrIz9GLRsK-rx7c74Cpmtg0sUc";
env.VAPID_PRIVATE_KEY ??= "XbEi_mf6N-E_G_rHzlUPoEUdw-blEZmHH63e_JDykd4";
