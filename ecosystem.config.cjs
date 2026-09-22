/**
 * Konfigurasi PM2 Student Hub (produksi & staging).
 *
 * Dijalankan oleh user sistem `studenthub` dengan PM2 miliknya sendiri
 * (PM2_HOME=/home/studenthub/.pm2, unit systemd pm2-studenthub) — lihat docs/deploy/BOOTSTRAP.md.
 * Deploy memanggil: pm2 startOrReload ecosystem.config.cjs --only <nama> --update-env
 *
 * - Satu proses fork per lingkungan: limiter & throttle aplikasi ada di memori proses.
 * - App hanya mendengar 127.0.0.1; publik lewat nginx (docs/deploy/nginx-*.conf).
 * - APP_VERSION (sha git pendek) di-export remote-deploy.sh sebelum perintah pm2 dan dibaca DI SINI
 *   saat konfigurasi dimuat; /api/health melaporkannya agar deploy tahu proses baru sudah hidup.
 * - Next memuat `.env` di cwd sendiri; variabel di bawah ini menang atas `.env`.
 *
 * Port & folder HARUS sama dengan scripts/deploy/remote-deploy.sh, docs/deploy/nginx-*.conf,
 * dan docs/deploy/studenthub.cron.
 */
const APP_VERSION = process.env.APP_VERSION || "unknown";

function nextApp(name, cwd, port) {
  return {
    name,
    cwd,
    script: "node_modules/next/dist/bin/next",
    args: ["start", "-H", "127.0.0.1", "-p", String(port)],
    exec_mode: "fork",
    instances: 1,
    max_memory_restart: "1500M",
    kill_timeout: 10000,
    // Jeda restart bertambah bila proses terus jatuh (mis. DB belum siap saat boot).
    exp_backoff_restart_delay: 200,
    env: {
      NODE_ENV: "production",
      TZ: "UTC",
      PORT: String(port),
      APP_VERSION,
    },
  };
}

module.exports = {
  apps: [
    nextApp("studenthub", "/www/wwwroot/studenthub", 3030),
    nextApp("studenthub-staging", "/www/wwwroot/studenthub-staging", 3031),
  ],
};
