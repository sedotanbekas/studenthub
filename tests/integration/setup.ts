/**
 * Dimuat sebelum setiap berkas test integrasi (lihat script test:int): mode test menyalakan
 * validasi respons terhadap kontrak di pipeline defineRoute.
 */
const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
