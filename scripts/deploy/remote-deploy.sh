#!/usr/bin/env bash
#
# Deploy Student Hub di VPS. Dijalankan workflow .github/workflows/ci-cd.yml (job deploy-staging /
# deploy-production) lewat SSH sebagai user sistem `studenthub` (BUKAN root), SETELAH workflow
# melakukan `git fetch` + `git reset --hard <sha yang lulus gate>` di folder target.
#
#   bash scripts/deploy/remote-deploy.sh <staging|production>
#
# Urutan: preflight (user, folder, .env, alat, disk) -> pnpm install --frozen-lockfile -> penjaga
# nama database -> backup database -> prisma migrate deploy -> (staging) seed demo -> build di bawah
# kunci build VPS -> pm2 startOrReload -> poll /api/health sampai melaporkan sha yang dipasang.
#
# Variabel opsional: NODE_BIN_DIR (bin Node aaPanel), BACKUP_ROOT (bawaan /home/studenthub/backups),
# BACKUP_KEEP (bawaan 14), DEPLOY_MIN_FREE_MB (bawaan 3072).
#
# Deploy manual / rollback (migrasi selalu aditif, jadi kode lama tetap cocok dengan skema baru):
#   cd /www/wwwroot/studenthub && git fetch --depth 50 origin master && git reset --hard <sha>
#   bash scripts/deploy/remote-deploy.sh production
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./common.sh
. "$SCRIPT_DIR/common.sh"
LOG_TAG=deploy

HEALTH_ATTEMPTS=40
HEALTH_INTERVAL_S=3
BUILD_LOCK=/tmp/studenthub-build.lock
# Total tunggu kunci + install + migrasi + build + health harus muat dalam command_timeout 30m workflow.
BUILD_LOCK_WAIT_S=900
DEPLOY_LOCK_WAIT_S=600
LOCK_BUSY_RC=75
MIN_FREE_MB="${DEPLOY_MIN_FREE_MB:-3072}"
CURRENT_STEP="persiapan"

usage() {
  echo "Pemakaian: bash scripts/deploy/remote-deploy.sh <staging|production>" >&2
  exit 2
}

# Pemetaan lingkungan — HARUS sama dengan ecosystem.config.cjs, docs/deploy/nginx-*.conf,
# docs/deploy/studenthub.cron, dan scripts/deploy/bootstrap-vps.sh.
resolve_target() {
  case "$TARGET" in
    production)
      APP_DIR=/www/wwwroot/studenthub
      PM2_NAME=studenthub
      PORT=3030
      EXPECTED_DB=studenthub
      ;;
    staging)
      APP_DIR=/www/wwwroot/studenthub-staging
      PM2_NAME=studenthub-staging
      PORT=3031
      EXPECTED_DB=studenthub_staging
      ;;
    *) usage ;;
  esac
  BACKUP_DIR="${BACKUP_ROOT:-/home/studenthub/backups}/$TARGET"
}

# Satu deploy per lingkungan. Skrip menjalankan ulang dirinya di bawah `flock -o`: kunci dipegang
# proses flock, TIDAK diwariskan ke anak (mis. daemon PM2 yang baru di-spawn), sehingga kunci tidak
# pernah tertinggal setelah deploy selesai.
hold_deploy_lock() {
  local lock_file="/tmp/studenthub-deploy-$TARGET.lock"
  if [ "${STUDENTHUB_DEPLOY_LOCK:-}" = "$lock_file" ]; then
    unset STUDENTHUB_DEPLOY_LOCK
    return 0
  fi
  local status=0
  STUDENTHUB_DEPLOY_LOCK="$lock_file" flock -w "$DEPLOY_LOCK_WAIT_S" -E "$LOCK_BUSY_RC" -o "$lock_file" \
    bash "$SCRIPT_DIR/remote-deploy.sh" "$TARGET" || status=$?
  if [ "$status" -eq "$LOCK_BUSY_RC" ]; then
    sh_warn "deploy $TARGET lain masih berjalan (kunci $lock_file) — dibatalkan"
  fi
  exit "$status"
}

on_exit() {
  local status=$?
  [ "$status" -ne 0 ] || return 0
  printf '[deploy %s] DEPLOY %s GAGAL pada langkah "%s" (kode %s)\n' \
    "$(sh_now)" "${TARGET:-?}" "$CURRENT_STEP" "$status" >&2
  if [ "$CURRENT_STEP" = "migrasi database" ]; then
    printf '[deploy %s] Skema mungkin setengah jadi. Cadangan sebelum migrasi ada di %s (lihat komentar scripts/deploy/backup-db.sh untuk pemulihan).\n' \
      "$(sh_now)" "$BACKUP_DIR" >&2
  fi
}

check_free_space() {
  local free_mb
  free_mb="$(sh_free_mb "$APP_DIR")"
  [ "${free_mb:-0}" -ge "$MIN_FREE_MB" ] \
    || sh_die "ruang disk bebas ${free_mb} MB < ${MIN_FREE_MB} MB — bersihkan disk dulu"
}

preflight() {
  [ "$(id -u)" -ne 0 ] || sh_die "jangan jalankan sebagai root; deploy berjalan sebagai user studenthub"
  [ -d "$APP_DIR/.git" ] || sh_die "$APP_DIR bukan checkout git (bootstrap VPS belum dijalankan?)"
  local repo_root app_root
  repo_root="$SH_REPO_ROOT"
  app_root="$(cd "$APP_DIR" && pwd -P)"
  [ "$repo_root" = "$app_root" ] || sh_die "skrip ini berasal dari $repo_root, bukan $app_root — target salah?"
  cd "$APP_DIR"
  [ -f .env ] || sh_die ".env tidak ada di $APP_DIR (lihat docs/deploy/BOOTSTRAP.md)"
  [ -O .env ] || sh_die ".env harus dimiliki user $(id -un)"
  chmod 600 .env
  # Sejak P5 app gagal start tanpa kunci ini: hentikan deploy SEBELUM migrasi/restart.
  grep -qE '^TOTP_ENC_KEY=.+' .env \
    || sh_die ".env $TARGET belum memuat TOTP_ENC_KEY — jalankan 'bash /root/bootstrap-vps.sh env' sebagai root (lihat docs/deploy/BOOTSTRAP.md)"
  sh_require_cmds node pnpm pm2 git curl flock nice
  sh_require_node_major
  check_free_space
}

guard_database() {
  local db_name
  db_name="$(pnpm exec tsx scripts/deploy/db-name.ts | tail -n 1)" \
    || sh_die "gagal membaca nama database dari .env"
  [ "$db_name" = "$EXPECTED_DB" ] \
    || sh_die "PENJAGA: .env $TARGET menunjuk database '$db_name', seharusnya '$EXPECTED_DB' — deploy dihentikan"
  sh_log "database: $db_name"
}

# Seed demo hanya untuk staging dan hanya bila skripnya sudah ada (baru ditambahkan di fase P1).
seed_demo() {
  if [ -f scripts/seed-demo.ts ]; then
    pnpm db:seed:demo
  else
    sh_warn "scripts/seed-demo.ts belum ada — seed demo dilewati"
  fi
}

# Build Next memakan ~3 GB; kunci bersama mencegah dua build (staging/produksi/aplikasi lain) jalan
# bersamaan. `-o`: kunci tidak diwariskan ke proses anak build.
build_app() {
  flock -w "$BUILD_LOCK_WAIT_S" -o "$BUILD_LOCK" \
    env NODE_OPTIONS=--max-old-space-size=3072 nice -n 10 pnpm build
}

reload_app() {
  pm2 startOrReload ecosystem.config.cjs --only "$PM2_NAME" --update-env
  pm2 save
}

# Sehat = /api/health menjawab 2xx DAN melaporkan sha yang baru dipasang (bukan proses lama).
wait_for_health() {
  local url="http://127.0.0.1:$PORT/api/health" body attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    body="$(curl -fsS --max-time 5 "$url" 2>/dev/null || true)"
    if [[ "$body" == *"\"version\":\"$APP_VERSION\""* ]]; then
      sh_log "sehat pada percobaan $attempt (versi $APP_VERSION)"
      return 0
    fi
    sleep "$HEALTH_INTERVAL_S"
  done
  sh_warn "health tidak melaporkan versi $APP_VERSION setelah $HEALTH_ATTEMPTS percobaan; log terakhir:"
  pm2 logs "$PM2_NAME" --lines 80 --nostream || true
  return 1
}

run_step() {
  CURRENT_STEP="$1"
  shift
  sh_log "==> $CURRENT_STEP"
  "$@"
}

main() {
  [ "$#" -eq 1 ] || usage
  TARGET="$1"
  resolve_target
  hold_deploy_lock
  trap on_exit EXIT
  sh_trap_signals
  sh_setup_path
  run_step "preflight" preflight
  # confirmModulesPurge=false: tanpa TTY pnpm membatalkan install bila node_modules perlu dibuat ulang.
  run_step "pnpm install" pnpm install --frozen-lockfile --config.confirmModulesPurge=false
  run_step "penjaga nama database" guard_database
  run_step "backup database" env APP_DIR="$APP_DIR" BACKUP_DIR="$BACKUP_DIR" bash scripts/deploy/backup-db.sh
  run_step "migrasi database" pnpm db:migrate
  if [ "$TARGET" = staging ]; then
    run_step "seed data demo" seed_demo
  fi
  APP_VERSION="$(git rev-parse --short HEAD)"
  export APP_VERSION
  run_step "build $APP_VERSION" build_app
  run_step "pm2 startOrReload $PM2_NAME" reload_app
  run_step "health check :$PORT" wait_for_health
  CURRENT_STEP="selesai"
  sh_log "deploy $TARGET selesai: versi $APP_VERSION"
}

main "$@"
