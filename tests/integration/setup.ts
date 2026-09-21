/**
 * Dimuat sebelum setiap berkas test integrasi (lihat script test:int): mode test menyalakan
 * validasi respons terhadap kontrak di pipeline defineRoute.
 * DEFER_MODE=inline: pekerjaan ctx.defer (mis. kick push dispatch setelah notifikasi) dijalankan
 * langsung, karena `after()` Next.js butuh request scope yang tidak ada saat route dipanggil dari test.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
env.DEFER_MODE ??= "inline";
