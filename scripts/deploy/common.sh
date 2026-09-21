# shellcheck shell=bash
#
# Pustaka bersama skrip deploy Student Hub. Di-SOURCE (bukan dijalankan) oleh remote-deploy.sh,
# backup-db.sh, dan backup-storage.sh. Pemanggil wajib sudah `set -euo pipefail` dan boleh mengisi
# LOG_TAG sebelum memanggil fungsi log.

# Node aaPanel di VPS. Ganti lewat NODE_BIN_DIR bila versi Node di VPS berubah.
SH_DEFAULT_NODE_BIN_DIR=/www/server/nvm/versions/node/v24.18.1/bin
SH_MIN_NODE_MAJOR=24

# Akar repo = dua tingkat di atas berkas ini (scripts/deploy/common.sh).
SH_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"

sh_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
sh_log() { printf '[%s %s] %s\n' "${LOG_TAG:-deploy}" "$(sh_now)" "$*"; }
sh_warn() { printf '[%s %s] PERINGATAN: %s\n' "${LOG_TAG:-deploy}" "$(sh_now)" "$*" >&2; }
sh_die() {
  printf '[%s %s] GAGAL: %s\n' "${LOG_TAG:-deploy}" "$(sh_now)" "$*" >&2
  exit 1
}

# Stempel waktu UTC untuk nama arsip, mis. 20260921T203000Z (urut leksikal = urut waktu).
sh_utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }

# Sinyal diubah menjadi exit agar trap EXIT (pembersihan berkas kredensial/arsip setengah jadi)
# selalu berjalan, juga saat Actions memutus sesi atau operator menekan Ctrl-C.
sh_trap_signals() {
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# PATH untuk sesi non-interaktif (SSH Actions, cron). ~/.local/bin DI DEPAN: shim pnpm dari corepack
# (versi terkunci `packageManager`) dan pm2 milik user studenthub harus menang atas pnpm/pm2 global
# yang mungkin dipasang root di folder bin Node aaPanel.
sh_setup_path() {
  local node_bin="${NODE_BIN_DIR:-$SH_DEFAULT_NODE_BIN_DIR}"
  [ -x "$node_bin/node" ] || sh_die "node tidak ditemukan di $node_bin (atur NODE_BIN_DIR)"
  export PATH="$HOME/.local/bin:$node_bin:$PATH"
  export PM2_HOME="${PM2_HOME:-$HOME/.pm2}"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export npm_config_update_notifier=false
}

sh_require_cmds() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || sh_die "perintah '$cmd' tidak ditemukan di PATH"
  done
}

sh_require_node_major() {
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge "$SH_MIN_NODE_MAJOR" ] || sh_die "Node $major terlalu lama (butuh >= $SH_MIN_NODE_MAJOR)"
}

# Nilai kosong, bukan angka, atau 0 pada jumlah simpanan akan membuat rotasi menghapus SEMUA arsip,
# termasuk yang baru dibuat — tolak sebelum melakukan apa pun.
sh_require_positive_int() {
  local name="$1" value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt 1 ]; then
    sh_die "$name harus bilangan bulat >= 1 (ditemukan '$value')"
  fi
}

# Ruang bebas (MB) pada filesystem yang memuat path $1.
sh_free_mb() { df -Pm "$1" | awk 'NR==2 {print $4}'; }

# Menyimpan $3 berkas terbaru yang cocok dengan pola $2 di direktori $1; sisanya dihapus.
sh_rotate() {
  local dir="$1" pattern="$2" keep="$3"
  find "$dir" -maxdepth 1 -type f -name "$pattern" -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n +"$((keep + 1))" \
    | cut -d' ' -f2- \
    | while IFS= read -r old; do rm -f -- "$old"; done
}

sh_count_files() {
  find "$1" -maxdepth 1 -type f -name "$2" | wc -l
}
