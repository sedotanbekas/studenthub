#!/usr/bin/env bash
#
# Backup database Student Hub (staging/produksi) ke $BACKUP_DIR/<db>-<UTC>.sql.gz.
#
# Dipanggil remote-deploy.sh SEBELUM `prisma migrate deploy`, dan oleh cron harian produksi
# (docs/deploy/studenthub.cron). MENGAPA sebelum migrasi: DDL MariaDB tidak transaksional, jadi
# migrasi yang gagal di tengah meninggalkan skema setengah jadi. Dump sesaat sebelum migrasi memberi
# titik pulih yang sezaman dengan kode yang sedang dipasang. Bila backup gagal, deploy ikut gagal —
# migrasi tidak pernah berjalan tanpa cadangan.
#
# Pemakaian (sebagai user studenthub, BUKAN root):
#   BACKUP_DIR=/home/studenthub/backups/production bash scripts/deploy/backup-db.sh
# Variabel: BACKUP_DIR (wajib), APP_DIR (bawaan: akar repo skrip ini), BACKUP_KEEP (bawaan 14),
#           NODE_BIN_DIR (bawaan: Node aaPanel v24.18.1).
#
# Kredensial & nama database dibaca dari DATABASE_URL di $APP_DIR/.env oleh
# scripts/deploy/db-backup-cnf.ts ke berkas mktemp 0600 yang dihapus saat skrip keluar: password
# tidak pernah lewat argumen proses, variabel shell, maupun log Actions.
#
# PEMULIHAN. Dump dibuat TANPA --databases (tanpa CREATE DATABASE/USE): database tujuan harus sudah
# ada dan disebut eksplisit.
#   cd /www/wwwroot/studenthub && pm2 stop studenthub          # hentikan penulisan selama restore
#   CNF="$(mktemp)" && pnpm exec tsx scripts/deploy/db-backup-cnf.ts "$CNF"   # mencetak nama DB
#   gzip -dc /home/studenthub/backups/production/studenthub-<stamp>.sql.gz \
#     | /www/server/mysql/bin/mariadb --defaults-extra-file="$CNF" studenthub
#   rm -f "$CNF" && pm2 start studenthub
# Awas: dump hanya memuat DROP TABLE untuk tabel yang ADA saat dump dibuat. Bila migrasi gagal
# setelah sempat membuat tabel baru, DROP tabel itu manual dulu agar skema kembali persis.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./common.sh
. "$SCRIPT_DIR/common.sh"
LOG_TAG=backup-db

APP_DIR="${APP_DIR:-$SH_REPO_ROOT}"
BACKUP_DIR="${BACKUP_DIR:-}"
KEEP="${BACKUP_KEEP:-14}"
CNF=""
PART=""

# aaPanel memasang klien MariaDB di /www/server/mysql/bin, yang tidak selalu ada di PATH sesi
# non-interaktif (SSH Actions, cron).
find_dump_tool() {
  local candidate
  for candidate in mariadb-dump mysqldump \
    /www/server/mysql/bin/mariadb-dump /www/server/mysql/bin/mysqldump; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# Pembersihan TANPA SYARAT: berkas kredensial dan dump setengah jadi selalu dibuang. Arsip final
# hanya muncul lewat `mv` atomik setelah lulus verifikasi, jadi yang dihapus di sini selalu berkas kerja.
cleanup() {
  rm -f -- ${CNF:+"$CNF"} ${PART:+"$PART"}
}

# --defaults-extra-file wajib menjadi opsi pertama. --single-transaction: snapshot InnoDB konsisten
# tanpa mengunci tabel selagi aplikasi berjalan. --no-tablespaces: tidak butuh hak PROCESS.
# --default-character-set=utf8mb4: cegah transkode diam-diam karakter 4 byte menjadi '?'.
run_dump() {
  "$DUMP" --defaults-extra-file="$CNF" \
    --single-transaction --triggers --no-tablespaces --hex-blob \
    --default-character-set=utf8mb4 "$@" "$DB_NAME"
}

# --routines butuh SELECT pada mysql.proc yang biasanya tidak dimiliki user aplikasi; proyek ini tidak
# memakai stored routine, jadi bila ditolak ulangi tanpa --routines daripada menggagalkan deploy.
dump_to_part() {
  if ! run_dump --routines | gzip > "$PART"; then
    sh_warn "dump pertama gagal; mencoba ulang tanpa --routines"
    run_dump | gzip > "$PART"
  fi
}

# 0 = dump utuh berisi tabel; 3 = dump utuh tetapi database belum punya tabel. Selain itu keluar gagal.
verify_part() {
  gzip -t "$PART" || sh_die "arsip gzip $PART rusak"
  gzip -dc "$PART" | tail -n 1 | grep -q '^-- Dump completed' \
    || sh_die "dump tidak lengkap (penanda '-- Dump completed' tidak ada)"
  local tables
  tables="$(gzip -dc "$PART" | grep -c '^CREATE TABLE' || true)"
  [ "${tables:-0}" -ge 1 ] || return 3
}

main() {
  [ -n "$BACKUP_DIR" ] || sh_die "BACKUP_DIR wajib diisi (mis. /home/studenthub/backups/production)"
  sh_require_positive_int BACKUP_KEEP "$KEEP"
  sh_trap_signals
  trap cleanup EXIT
  sh_setup_path
  cd "$APP_DIR"
  DUMP="$(find_dump_tool)" || sh_die "mariadb-dump/mysqldump tidak ditemukan di PATH maupun /www/server/mysql/bin"
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  CNF="$(mktemp)"
  DB_NAME="$(pnpm exec tsx scripts/deploy/db-backup-cnf.ts "$CNF" | tail -n 1)" \
    || sh_die "gagal menyiapkan kredensial database dari .env"
  [[ "$DB_NAME" =~ ^[A-Za-z0-9_$][A-Za-z0-9_$-]*$ ]] || sh_die "nama database tidak sah: '$DB_NAME'"

  local file
  file="$BACKUP_DIR/$DB_NAME-$(sh_utc_stamp).sql.gz"
  PART="$file.part"
  dump_to_part
  local status=0
  verify_part || status=$?
  if [ "$status" -eq 3 ]; then
    # Database kosong (deploy pertama): tidak ada yang hilang. Arsip lama sengaja TIDAK dirotasi agar
    # database yang terhapus tidak pernah mendorong keluar cadangan yang masih berisi data.
    sh_warn "database '$DB_NAME' belum memiliki tabel — tidak ada cadangan yang disimpan"
    return 0
  fi

  mv -- "$PART" "$file"
  PART=""
  sh_rotate "$BACKUP_DIR" "$DB_NAME-*.sql.gz" "$KEEP"
  sh_log "$file ($(du -h "$file" | cut -f1)); tersimpan $(sh_count_files "$BACKUP_DIR" "$DB_NAME-*.sql.gz") arsip"
}

main "$@"
