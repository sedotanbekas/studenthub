#!/usr/bin/env bash
#
# Arsip direktori storage Student Hub (STORAGE_ROOT dari .env) ke $BACKUP_DIR/storage-<UTC>.tar.gz.
# Dijalankan cron harian produksi (docs/deploy/studenthub.cron) sebagai user studenthub.
#
# Pemakaian:
#   BACKUP_DIR=/home/studenthub/backups/production/daily bash scripts/deploy/backup-storage.sh
# Variabel: BACKUP_DIR (wajib), APP_DIR (bawaan: akar repo skrip ini), STORAGE_BACKUP_KEEP (bawaan 7),
#           BACKUP_MIN_FREE_MB (bawaan 5120 — sama dengan batas tolak unggahan aplikasi),
#           NODE_BIN_DIR (bawaan: Node aaPanel v24.18.1).
#
# Folder tmp/ (unggahan yang sedang ditulis) tidak ikut. Aplikasi tetap berjalan selama pengarsipan,
# jadi berkas yang berubah/terhapus di tengah jalan (mis. purge selfie) wajar dan tidak menggagalkan.
#
# PEMULIHAN (aplikasi dihentikan dulu):
#   pm2 stop studenthub
#   tar -xzf /home/studenthub/backups/production/daily/storage-<stamp>.tar.gz -C /www/wwwroot
#   pm2 start studenthub
#
# CATATAN KAPASITAS: arsip penuh harian berukuran kira-kira sebesar storage (gambar tidak
# terkompresi lagi). Skrip menolak berjalan bila sisa disk setelah arsip < BACKUP_MIN_FREE_MB.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./common.sh
. "$SCRIPT_DIR/common.sh"
LOG_TAG=backup-storage

APP_DIR="${APP_DIR:-$SH_REPO_ROOT}"
BACKUP_DIR="${BACKUP_DIR:-}"
KEEP="${STORAGE_BACKUP_KEEP:-7}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-5120}"
ARCHIVE_PATTERN='storage-*.tar.gz'
PART=""

cleanup() {
  rm -f -- ${PART:+"$PART"}
}

# Path kanonik (tanpa symlink/..) agar pemeriksaan "BACKUP_DIR di dalam STORAGE_ROOT" tidak bisa dikelabui.
resolve_storage_root() {
  local raw root
  raw="$(pnpm exec tsx scripts/deploy/storage-root.ts | tail -n 1)" \
    || sh_die "gagal membaca STORAGE_ROOT dari .env"
  root="$(realpath -e -- "$raw")" || sh_die "STORAGE_ROOT '$raw' tidak ada"
  [ -d "$root" ] || sh_die "STORAGE_ROOT '$root' bukan direktori"
  [ "$root" != "/" ] || sh_die "STORAGE_ROOT tidak boleh '/'"
  printf '%s\n' "$root"
}

# Arsip yang ditulis ke dalam folder yang sedang diarsipkan akan ikut terarsip dan membengkak tiap hari.
reject_backup_inside_storage() {
  local root="$1"
  case "$BACKUP_DIR/" in
    "$root"/*) sh_die "BACKUP_DIR ($BACKUP_DIR) tidak boleh berada di dalam STORAGE_ROOT ($root)" ;;
  esac
}

# Arsip ~ sebesar storage; sisakan minimal MIN_FREE_MB agar MariaDB & aplikasi lain tidak kehabisan disk.
check_capacity() {
  local root="$1" need_mb free_mb
  need_mb="$(du -sm --exclude=tmp "$root" | cut -f1)"
  free_mb="$(sh_free_mb "$BACKUP_DIR")"
  if [ $((free_mb - need_mb)) -lt "$MIN_FREE_MB" ]; then
    sh_die "ruang disk tidak cukup: bebas ${free_mb} MB, storage ${need_mb} MB, sisa minimum ${MIN_FREE_MB} MB"
  fi
}

# GNU tar keluar 1 bila ada berkas berubah/terhapus selagi dibaca — wajar karena aplikasi tetap
# berjalan. Kode >= 2 adalah kegagalan sungguhan.
create_archive() {
  local root="$1" status=0
  local parent base
  parent="$(dirname "$root")"
  base="$(basename "$root")"
  tar --create --gzip --file="$PART" --directory="$parent" \
    --exclude="$base/tmp" --one-file-system --ignore-failed-read \
    --warning=no-file-changed --warning=no-file-removed \
    "$base" || status=$?
  [ "$status" -le 1 ] || sh_die "tar gagal (kode $status)"
  tar --list --gzip --file="$PART" > /dev/null || sh_die "arsip $PART tidak dapat dibaca ulang"
}

main() {
  [ -n "$BACKUP_DIR" ] || sh_die "BACKUP_DIR wajib diisi (mis. /home/studenthub/backups/production/daily)"
  sh_require_positive_int STORAGE_BACKUP_KEEP "$KEEP"
  sh_require_positive_int BACKUP_MIN_FREE_MB "$MIN_FREE_MB"
  sh_trap_signals
  trap cleanup EXIT
  sh_setup_path
  cd "$APP_DIR"

  local root file
  root="$(resolve_storage_root)"
  BACKUP_DIR="$(realpath -m -- "$BACKUP_DIR")"
  reject_backup_inside_storage "$root"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  check_capacity "$root"
  file="$BACKUP_DIR/storage-$(sh_utc_stamp).tar.gz"
  PART="$file.part"
  create_archive "$root"

  mv -- "$PART" "$file"
  PART=""
  sh_rotate "$BACKUP_DIR" "$ARCHIVE_PATTERN" "$KEEP"
  sh_log "$file ($(du -h "$file" | cut -f1)); tersimpan $(sh_count_files "$BACKUP_DIR" "$ARCHIVE_PATTERN") arsip"
}

main "$@"
