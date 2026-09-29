#!/usr/bin/env bash
#
# Buat / reset akun uji di VPS (workflow manual .github/workflows/akun-uji.yml, lewat SSH sebagai user
# `studenthub`). Kata sandi dibaca dari env TEST_ACCOUNT_PASSWORD (secret GitHub, disamarkan di log).
#
#   TEST_ACCOUNT_PASSWORD=... bash scripts/deploy/akun-uji.sh <staging|production>
#
# Kode yang dijalankan = kode yang sedang terpasang di folder lingkungan (hasil deploy terakhir).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./common.sh
. "$SCRIPT_DIR/common.sh"
LOG_TAG=akun-uji

case "${1:-}" in
  production) APP_DIR=/www/wwwroot/studenthub ;;
  staging) APP_DIR=/www/wwwroot/studenthub-staging ;;
  *) echo "Pemakaian: bash scripts/deploy/akun-uji.sh <staging|production>" >&2; exit 2 ;;
esac

[ -n "${TEST_ACCOUNT_PASSWORD:-}" ] || sh_die "TEST_ACCOUNT_PASSWORD kosong (isi secret GitHub TEST_ACCOUNT_PASSWORD)"
sh_setup_path
sh_require_cmds node pnpm
cd "$APP_DIR"
[ -f scripts/create-test-accounts.ts ] || sh_die "kode di $APP_DIR belum memuat scripts/create-test-accounts.ts — tunggu deploy selesai"
sh_log "membuat/mereset akun uji ($1)"
pnpm db:akun-uji
