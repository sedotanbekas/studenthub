#!/usr/bin/env bash
#
# Bootstrap VPS Student Hub — dijalankan SEBAGAI ROOT, idempoten (aman diulang kapan saja).
# Mengerjakan bagian non-interaktif docs/deploy/BOOTSTRAP.md; langkah lain (DNS, situs & SSL aaPanel,
# secret GitHub, super admin pertama) tetap manual sesuai dokumen itu.
#
#   bash bootstrap-vps.sh                 # semua fase berurutan
#   bash bootstrap-vps.sh db jobconf      # fase tertentu saja (preflight selalu dijalankan dulu)
#
# Fase: preflight user tooling dirs clone env db jobconf cron pm2 nginx summary
#
# Variabel opsional:
#   DEPLOY_PUBKEY_FILE  kunci publik ssh-ed25519 deploy GitHub Actions (fase user) -> authorized_keys
#                       user studenthub dengan opsi `restrict` (tanpa forwarding port/agent/X11, tanpa PTY).
#   DB_ROOT_CNF         berkas opsi klien MariaDB root (mode 600, isi `[client] user=root password="..."`)
#                       untuk fase db. Bila kosong dan terminal interaktif, password root ditanya tanpa
#                       gema. Bila keduanya tidak ada: fase db dilewati (atau gagal bila diminta eksplisit).
#   STUDENTHUB_BRANCH   branch yang di-clone (bawaan master).
#   NODE_BIN_DIR        bin Node aaPanel (bawaan /www/server/nvm/versions/node/v24.18.1/bin).
#   PM2_VERSION         versi pm2 untuk user studenthub (bawaan latest).
#   WEB_GROUP           grup user nginx aaPanel (bawaan www).
#
# Skrip ini TIDAK PERNAH mencetak rahasia. Rahasia dibuat dengan `openssl rand`, ditulis langsung ke
# berkas 0600, dan dikirim ke MariaDB lewat stdin (bukan argumen proses). `.env` yang sudah ada tidak
# pernah ditimpa.
set -euo pipefail
umask 022

APP_USER=studenthub
APP_HOME=/home/studenthub
REPO_URL=https://github.com/sedotanbekas/studenthub.git
REPO_BRANCH="${STUDENTHUB_BRANCH:-master}"
NODE_BIN_DIR="${NODE_BIN_DIR:-/www/server/nvm/versions/node/v24.18.1/bin}"
PNPM_VERSION=10.15.0 # samakan dengan "packageManager" di package.json
PM2_VERSION="${PM2_VERSION:-latest}"
WEB_GROUP="${WEB_GROUP:-www}"
MYSQL_BIN_DIR=/www/server/mysql/bin
NGINX_BIN=/www/server/nginx/sbin/nginx
NGINX_EXT_ROOT=/www/server/panel/vhost/nginx/extension
ETC_DIR=/etc/studenthub
LOG_DIR=/var/log/studenthub
BACKUP_ROOT="$APP_HOME/backups"
APP_PATH="$APP_HOME/.local/bin:$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

ENVS=(production staging)
ALL_PHASES=(preflight user tooling dirs clone env db jobconf cron pm2 nginx summary)
# Pemetaan lingkungan — HARUS sama dengan ecosystem.config.cjs, remote-deploy.sh, docs/deploy/*.
declare -A APP_DIR=([production]=/www/wwwroot/studenthub [staging]=/www/wwwroot/studenthub-staging)
declare -A STORAGE_DIR=([production]=/www/wwwroot/studenthub-storage [staging]=/www/wwwroot/studenthub-storage-staging)
declare -A DB_NAME=([production]=studenthub [staging]=studenthub_staging)
declare -A DB_USER=([production]=studenthub [staging]=studenthub_staging)
declare -A DOMAIN=([production]=studenthub.medialab.co.id [staging]=staging.studenthub.medialab.co.id)
declare -A NGINX_SNIPPET=([production]=nginx-studenthub.conf [staging]=nginx-studenthub-staging.conf)

WORK_DIR=""
ROOT_CNF=""
MYSQL_BIN=""
DB_REQUIRED=0
PENDING_FILES=()
NGINX_RESTORE=()

log() { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '[bootstrap] PERINGATAN: %s\n' "$*" >&2; }
die() {
  printf '[bootstrap] GAGAL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local file
  for file in "${PENDING_FILES[@]}"; do rm -f -- "$file"; done
  [ -z "$WORK_DIR" ] || rm -rf -- "$WORK_DIR"
}

# Menjalankan perintah sebagai user studenthub dari folder yang bisa diaksesnya (npm/corepack gagal
# bila cwd = /root yang tidak terbaca user itu).
as_app_in() {
  local dir="$1"
  shift
  (cd "$dir" && sudo -u "$APP_USER" -H env PATH="$APP_PATH" PM2_HOME="$APP_HOME/.pm2" \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 npm_config_update_notifier=false "$@")
}
as_app() { as_app_in "$APP_HOME" "$@"; }

rand_hex() { openssl rand -hex "$1"; }

ensure_dir() {
  local mode="$1" owner="$2" path="$3"
  mkdir -p -- "$path"
  chown "$owner" "$path"
  chmod "$mode" "$path"
}

# Berkas docs/deploy/<nama>: dari checkout tempat skrip ini berada, atau dari clone produksi.
asset_path() {
  local name="$1" candidate
  for candidate in "$SCRIPT_DIR/../../docs/deploy/$name" "${APP_DIR[production]}/docs/deploy/$name"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  die "berkas docs/deploy/$name tidak ditemukan (jalankan fase clone dulu)"
}

# Nilai KEY dari berkas .env (format KEY=nilai atau KEY="nilai"). Tidak pernah dicetak ke log.
read_env_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 1
  line="$(grep -E "^${key}=" "$file" | tail -n 1)" || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

# Menulis isi ke berkas 0600 secara atomik (mktemp di folder yang sama lalu mv).
write_private_file() {
  local file="$1" owner="$2" content="$3" tmp
  tmp="$(mktemp "$file.XXXXXX")"
  PENDING_FILES+=("$tmp")
  printf '%s\n' "$content" > "$tmp"
  chown "$owner" "$tmp"
  chmod 600 "$tmp"
  mv -f -- "$tmp" "$file"
}

phase_preflight() {
  [ "$(id -u)" -eq 0 ] || die "jalankan sebagai root"
  local cmd
  for cmd in git curl openssl flock sudo useradd usermod getent install systemctl sed awk grep cmp; do
    command -v "$cmd" >/dev/null 2>&1 || die "perintah '$cmd' tidak ditemukan"
  done
  [ -x "$NODE_BIN_DIR/node" ] || die "node tidak ada di $NODE_BIN_DIR (atur NODE_BIN_DIR)"
  [ -x "$NODE_BIN_DIR/corepack" ] || die "corepack tidak ada di $NODE_BIN_DIR"
  getent group "$WEB_GROUP" >/dev/null || die "grup web '$WEB_GROUP' tidak ada (user nginx aaPanel)"
  log "preflight OK (node $("$NODE_BIN_DIR/node" -v), grup web $WEB_GROUP)"
}

install_deploy_key() {
  local file="${DEPLOY_PUBKEY_FILE:-}" auth="$APP_HOME/.ssh/authorized_keys" key body
  local re='^ssh-ed25519 [A-Za-z0-9+/]+=*( .*)?$'
  if [ -z "$file" ]; then
    warn "DEPLOY_PUBKEY_FILE kosong — kunci deploy belum dipasang (BOOTSTRAP.md langkah 1)"
    return 0
  fi
  [ -r "$file" ] || die "DEPLOY_PUBKEY_FILE '$file' tidak terbaca"
  key="$(head -n 1 "$file" | tr -d '\r')"
  [[ "$key" =~ $re ]] || die "DEPLOY_PUBKEY_FILE bukan kunci publik ssh-ed25519"
  body="$(printf '%s' "$key" | awk '{print $2}')"
  touch "$auth"
  if grep -qF -- "$body" "$auth"; then
    log "kunci deploy sudah terpasang"
  else
    printf 'restrict %s\n' "$key" >> "$auth"
    log "kunci deploy dipasang dengan opsi restrict"
  fi
  chown "$APP_USER:$APP_USER" "$auth"
  chmod 600 "$auth"
}

phase_user() {
  if id "$APP_USER" >/dev/null 2>&1; then
    log "user $APP_USER sudah ada"
  else
    useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash --user-group "$APP_USER"
    log "user sistem $APP_USER dibuat"
  fi
  # '*' = tanpa password yang sah (login hanya lewat kunci SSH) tetapi akun tidak "terkunci" bagi sshd.
  usermod -p '*' "$APP_USER"
  ensure_dir 750 "$APP_USER:$APP_USER" "$APP_HOME"
  ensure_dir 700 "$APP_USER:$APP_USER" "$APP_HOME/.ssh"
  ensure_dir 755 "$APP_USER:$APP_USER" "$APP_HOME/.local"
  ensure_dir 755 "$APP_USER:$APP_USER" "$APP_HOME/.local/bin"
  install_deploy_key
}

# Kenyamanan operator (`sudo -iu studenthub`): PATH & PM2_HOME di shell interaktif. Sesi deploy
# non-interaktif tidak bergantung pada ini (remote-deploy.sh mengatur PATH sendiri).
ensure_shell_path() {
  local rc="$APP_HOME/.bashrc" marker="# studenthub-path (bootstrap-vps.sh)"
  touch "$rc"
  if ! grep -qF "$marker" "$rc"; then
    printf '\n%s\nexport PATH="$HOME/.local/bin:%s:$PATH"\nexport PM2_HOME="$HOME/.pm2"\n' "$marker" "$NODE_BIN_DIR" >> "$rc"
  fi
  chown "$APP_USER:$APP_USER" "$rc"
}

phase_tooling() {
  as_app node -v >/dev/null || die "user $APP_USER tidak bisa menjalankan $NODE_BIN_DIR/node (izin folder?)"
  ensure_shell_path
  as_app corepack enable --install-directory "$APP_HOME/.local/bin" pnpm
  as_app corepack install -g "pnpm@$PNPM_VERSION"
  log "pnpm $(as_app pnpm --version) (corepack, $APP_HOME/.local/bin)"
  if [ ! -x "$APP_HOME/.local/bin/pm2" ]; then
    as_app npm install -g --prefix "$APP_HOME/.local" "pm2@$PM2_VERSION"
  fi
  # Versi dibaca dari package.json: memanggil CLI pm2 di sini akan men-spawn daemon di luar systemd.
  log "pm2 $(as_app node -p "require('$APP_HOME/.local/lib/node_modules/pm2/package.json').version")"
}

setup_storage() {
  local root="$1"
  # nginx (grup web) hanya boleh menelusuri root dan membaca public/; private/ & tmp/ khusus aplikasi.
  # setgid pada public/ membuat subfolder baru ikut bergrup web.
  ensure_dir 750 "$APP_USER:$WEB_GROUP" "$root"
  ensure_dir 2755 "$APP_USER:$WEB_GROUP" "$root/public"
  ensure_dir 700 "$APP_USER:$APP_USER" "$root/private"
  ensure_dir 700 "$APP_USER:$APP_USER" "$root/tmp"
}

phase_dirs() {
  local env
  ensure_dir 750 "$APP_USER:$APP_USER" "$LOG_DIR"
  ensure_dir 750 "root:$APP_USER" "$ETC_DIR"
  ensure_dir 700 "$APP_USER:$APP_USER" "$BACKUP_ROOT"
  for env in "${ENVS[@]}"; do
    ensure_dir 750 "$APP_USER:$APP_USER" "${APP_DIR[$env]}"
    ensure_dir 700 "$APP_USER:$APP_USER" "$BACKUP_ROOT/$env"
    setup_storage "${STORAGE_DIR[$env]}"
  done
  ensure_dir 700 "$APP_USER:$APP_USER" "$BACKUP_ROOT/production/daily"
  log "folder aplikasi, storage, backup, log, dan $ETC_DIR siap"
}

phase_clone() {
  local env dir
  for env in "${ENVS[@]}"; do
    dir="${APP_DIR[$env]}"
    [ -d "$dir" ] || die "$dir belum ada — jalankan fase dirs dulu"
    if [ -d "$dir/.git" ]; then
      log "$dir sudah berupa checkout git — dilewati"
      continue
    fi
    [ -z "$(ls -A "$dir")" ] || die "$dir tidak kosong dan bukan checkout git"
    as_app git clone --depth 50 --branch "$REPO_BRANCH" "$REPO_URL" "$dir"
    log "$dir di-clone dari $REPO_URL ($REPO_BRANCH)"
  done
}

render_env() {
  local env="$1" domain="${DOMAIN[$1]}"
  printf '# Student Hub %s — dibuat bootstrap-vps.sh %s. JANGAN di-commit; mode 0600.\n' "$env" "$(date -u +%F)"
  printf '# NODE_ENV, TZ, dan APP_VERSION diatur PM2 (ecosystem.config.cjs), bukan di sini.\n'
  printf 'DATABASE_URL="mysql://%s:%s@127.0.0.1:3306/%s"\n' "${DB_USER[$env]}" "$(rand_hex 24)" "${DB_NAME[$env]}"
  printf 'JWT_ACCESS_SECRET="%s"\n' "$(rand_hex 32)"
  printf 'AD_EVENT_SECRET="%s"\n' "$(rand_hex 32)"
  printf 'JOB_SECRET="%s"\n' "$(rand_hex 32)"
  printf '# Kunci AES-256-GCM rahasia TOTP super admin (32 byte hex). Jangan diganti setelah ada TOTP terdaftar.\n'
  printf 'TOTP_ENC_KEY="%s"\n' "$(rand_hex 32)"
  printf 'APP_ORIGIN="https://%s"\n' "$domain"
  printf 'PUBLIC_MEDIA_BASE_URL="https://%s/media"\n' "$domain"
  printf 'STORAGE_ROOT="%s"\n' "${STORAGE_DIR[$env]}"
  printf '# log | memory | expo (expo setelah proyek EAS siap; isi EXPO_ACCESS_TOKEN bila perlu)\n'
  printf 'PUSH_TRANSPORT="log"\n'
  printf 'EXPO_ACCESS_TOKEN=""\n'
  printf 'DOCS_BASIC_AUTH="docs:%s"\n' "$(rand_hex 12)"
  printf 'LOG_LEVEL="info"\n'
  if [ "$env" = staging ]; then
    printf '# Kata sandi akun demo untuk pnpm db:seed:demo (hanya staging).\n'
    printf 'DEMO_PASSWORD="Demo%s7"\n' "$(rand_hex 6)"
  fi
}

# .env lama (dibuat sebelum P5) belum memuat TOTP_ENC_KEY: tambahkan kunci acak di ujung berkas
# tanpa mengubah baris lain dan tanpa mencetak nilainya. Kunci yang sudah ada tidak pernah diganti.
append_missing_env_keys() {
  local file="$1"
  if ! grep -qE '^TOTP_ENC_KEY=' "$file"; then
    printf '\n# Kunci AES-256-GCM rahasia TOTP super admin (ditambahkan bootstrap-vps.sh %s).\nTOTP_ENC_KEY="%s"\n' \
      "$(date -u +%F)" "$(rand_hex 32)" >> "$file"
    log "$file: TOTP_ENC_KEY ditambahkan (nilai tidak ditampilkan) — restart PM2 lingkungan ini"
  fi
}

phase_env() {
  local env dir file tmp
  for env in "${ENVS[@]}"; do
    dir="${APP_DIR[$env]}"
    file="$dir/.env"
    [ -d "$dir" ] || die "$dir belum ada — jalankan fase dirs/clone dulu"
    if [ -f "$file" ]; then
      chown "$APP_USER:$APP_USER" "$file"
      chmod 600 "$file"
      append_missing_env_keys "$file"
      log "$file sudah ada — tidak ditimpa (mode dipastikan 0600)"
      continue
    fi
    tmp="$(mktemp "$file.XXXXXX")"
    PENDING_FILES+=("$tmp")
    render_env "$env" > "$tmp"
    chown "$APP_USER:$APP_USER" "$tmp"
    chmod 600 "$tmp"
    mv -f -- "$tmp" "$file"
    log "$file dibuat (0600; rahasia acak, tidak ditampilkan)"
  done
}

find_mysql_client() {
  local candidate
  for candidate in mariadb mysql "$MYSQL_BIN_DIR/mariadb" "$MYSQL_BIN_DIR/mysql"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

cnf_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

# Mengisi ROOT_CNF dari DB_ROOT_CNF atau dari prompt tanpa gema. Return 1 bila tidak tersedia.
resolve_root_cnf() {
  if [ -n "${DB_ROOT_CNF:-}" ]; then
    [ -r "$DB_ROOT_CNF" ] || die "DB_ROOT_CNF '$DB_ROOT_CNF' tidak terbaca"
    [ "$(stat -c %a "$DB_ROOT_CNF")" = 600 ] || die "DB_ROOT_CNF harus bermode 600"
    ROOT_CNF="$DB_ROOT_CNF"
    return 0
  fi
  [ -t 0 ] || return 1
  local password=""
  read -rsp "Password root MariaDB (aaPanel > Databases > Root password; tidak ditampilkan): " password
  printf '\n' >&2
  [ -n "$password" ] || return 1
  ROOT_CNF="$WORK_DIR/root.cnf"
  printf '[client]\nuser=root\npassword="%s"\n' "$(cnf_escape "$password")" > "$ROOT_CNF"
}

render_db_sql() {
  local db="$1" user="$2" pass="$3" host
  printf 'CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n' "$db"
  # User untuk 127.0.0.1 (TCP, dipakai DATABASE_URL) dan localhost (socket).
  for host in 127.0.0.1 localhost; do
    printf "CREATE USER IF NOT EXISTS '%s'@'%s' IDENTIFIED BY '%s';\n" "$user" "$host" "$pass"
    printf "ALTER USER '%s'@'%s' IDENTIFIED BY '%s';\n" "$user" "$host" "$pass"
    printf "GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'%s';\n" "$db" "$user" "$host"
  done
  printf 'FLUSH PRIVILEGES;\n'
}

provision_db() {
  local env="$1" url user pass db cnf
  local re='^mysql://([A-Za-z0-9_]+):([A-Fa-f0-9]{32,})@127\.0\.0\.1:3306/([A-Za-z0-9_]+)$'
  url="$(read_env_value "${APP_DIR[$env]}/.env" DATABASE_URL)" \
    || die "DATABASE_URL tidak ada di .env $env — jalankan fase env dulu"
  [[ "$url" =~ $re ]] \
    || die "DATABASE_URL $env bukan format bootstrap (mysql://user:<hex>@127.0.0.1:3306/db) — buat DB manual (BOOTSTRAP.md)"
  user="${BASH_REMATCH[1]}"
  pass="${BASH_REMATCH[2]}"
  db="${BASH_REMATCH[3]}"
  [ "$db" = "${DB_NAME[$env]}" ] || die "DATABASE_URL $env menunjuk '$db', seharusnya '${DB_NAME[$env]}'"
  render_db_sql "$db" "$user" "$pass" | "$MYSQL_BIN" --defaults-extra-file="$ROOT_CNF"
  cnf="$WORK_DIR/app-$env.cnf"
  printf '[client]\nhost=127.0.0.1\nport=3306\nuser=%s\npassword=%s\n' "$user" "$pass" > "$cnf"
  "$MYSQL_BIN" --defaults-extra-file="$cnf" -e 'SELECT 1' "$db" >/dev/null \
    || die "login $user@127.0.0.1 ke $db gagal setelah provisioning"
  log "database $db & user $user (127.0.0.1 + localhost) siap"
}

phase_db() {
  MYSQL_BIN="$(find_mysql_client)" || die "klien mariadb/mysql tidak ditemukan (juga di $MYSQL_BIN_DIR)"
  if ! resolve_root_cnf; then
    [ "$DB_REQUIRED" -eq 0 ] || die "kredensial root MariaDB diperlukan: set DB_ROOT_CNF atau jalankan di terminal"
    warn "kredensial root MariaDB tidak tersedia — fase db dilewati"
    return 0
  fi
  "$MYSQL_BIN" --defaults-extra-file="$ROOT_CNF" -e 'SELECT 1' >/dev/null || die "login root MariaDB gagal"
  local env
  for env in "${ENVS[@]}"; do provision_db "$env"; done
}

phase_jobconf() {
  local env secret
  local re='^[A-Za-z0-9._~+/=-]{32,}$'
  [ -d "$ETC_DIR" ] || die "$ETC_DIR belum ada — jalankan fase dirs dulu"
  for env in "${ENVS[@]}"; do
    secret="$(read_env_value "${APP_DIR[$env]}/.env" JOB_SECRET)" || die "JOB_SECRET tidak ada di .env $env"
    [[ "$secret" =~ $re ]] || die "JOB_SECRET $env memuat karakter yang tidak didukung berkas konfigurasi curl"
    write_private_file "$ETC_DIR/curl-job-$env.conf" "$APP_USER:$APP_USER" \
      "$(printf '# Dibuat bootstrap-vps.sh dari JOB_SECRET di .env %s; jalankan ulang fase jobconf bila .env berubah.\nheader = "X-Job-Secret: %s"' "$env" "$secret")"
    log "$ETC_DIR/curl-job-$env.conf ditulis (0600)"
  done
}

phase_cron() {
  local env
  for env in "${ENVS[@]}"; do
    [ -f "$ETC_DIR/curl-job-$env.conf" ] || die "curl-job-$env.conf belum ada — jalankan fase jobconf dulu"
  done
  install -m 644 -o root -g root "$(asset_path studenthub.cron)" /etc/cron.d/studenthub
  install -m 644 -o root -g root "$(asset_path logrotate-studenthub)" /etc/logrotate.d/studenthub
  log "/etc/cron.d/studenthub & /etc/logrotate.d/studenthub terpasang"
}

ensure_pm2_logrotate() {
  if as_app pm2 jlist 2>/dev/null | grep -q '"name":"pm2-logrotate"'; then
    log "modul pm2-logrotate sudah terpasang"
    return 0
  fi
  as_app pm2 install pm2-logrotate
  as_app pm2 set pm2-logrotate:max_size 20M
  as_app pm2 set pm2-logrotate:retain 14
  as_app pm2 set pm2-logrotate:compress true
  as_app pm2 save
}

phase_pm2() {
  [ -x "$APP_HOME/.local/bin/pm2" ] || die "pm2 belum terpasang — jalankan fase tooling dulu"
  local rendered="$WORK_DIR/pm2-studenthub.service"
  sed "s|@NODE_BIN_DIR@|$NODE_BIN_DIR|g" "$(asset_path pm2-studenthub.service)" > "$rendered"
  install -m 644 -o root -g root "$rendered" /etc/systemd/system/pm2-studenthub.service
  systemctl daemon-reload
  systemctl enable --now pm2-studenthub.service
  ensure_pm2_logrotate
  log "pm2-studenthub.service aktif ($(systemctl is-active pm2-studenthub.service))"
}

# Return 0 bila potongan dipasang/berubah, 1 bila sudah identik.
install_nginx_snippet() {
  local env="$1" target="$2" src backup
  src="$(asset_path "${NGINX_SNIPPET[$env]}")"
  if [ -f "$target" ] && cmp -s "$src" "$target"; then
    return 1
  fi
  if [ -f "$target" ]; then
    backup="$WORK_DIR/nginx-$env.bak"
    cp -p -- "$target" "$backup"
    NGINX_RESTORE+=("$target|$backup")
  else
    NGINX_RESTORE+=("$target|")
  fi
  install -m 644 -o root -g root "$src" "$target"
  log "potongan nginx $env dipasang: $target"
}

restore_nginx() {
  local entry target backup
  for entry in "${NGINX_RESTORE[@]}"; do
    target="${entry%%|*}"
    backup="${entry#*|}"
    if [ -n "$backup" ]; then cp -p -- "$backup" "$target"; else rm -f -- "$target"; fi
  done
}

phase_nginx() {
  local env ext changed=0
  for env in "${ENVS[@]}"; do
    ext="$NGINX_EXT_ROOT/${DOMAIN[$env]}"
    if [ ! -d "$ext" ]; then
      warn "situs ${DOMAIN[$env]} belum dibuat di aaPanel ($ext tidak ada) — dilewati"
      continue
    fi
    if install_nginx_snippet "$env" "$ext/studenthub.conf"; then changed=1; fi
  done
  if [ "$changed" -eq 0 ]; then
    log "konfigurasi nginx tidak berubah"
    return 0
  fi
  if ! "$NGINX_BIN" -t; then
    restore_nginx
    die "nginx -t gagal — potongan dikembalikan ke keadaan semula"
  fi
  "$NGINX_BIN" -s reload
  log "nginx di-reload"
}

summary_env() {
  local env="$1" dir="${APP_DIR[$1]}" env_mode="-"
  [ -f "$dir/.env" ] && env_mode="$(stat -c %a "$dir/.env")"
  printf '  %-10s checkout=%s .env=%s curl-job=%s nginx=%s\n' "$env" \
    "$([ -d "$dir/.git" ] && echo ya || echo BELUM)" "$env_mode" \
    "$([ -f "$ETC_DIR/curl-job-$env.conf" ] && echo ya || echo BELUM)" \
    "$([ -f "$NGINX_EXT_ROOT/${DOMAIN[$env]}/studenthub.conf" ] && echo ya || echo BELUM)"
}

phase_summary() {
  local keys=0 env allow
  [ -f "$APP_HOME/.ssh/authorized_keys" ] && keys="$(grep -c . "$APP_HOME/.ssh/authorized_keys" || true)"
  log "ringkasan:"
  printf '  user %s: %s, kunci SSH terpasang: %s\n' "$APP_USER" "$(id -u "$APP_USER" 2>/dev/null || echo BELUM)" "$keys"
  for env in "${ENVS[@]}"; do summary_env "$env"; done
  printf '  cron: %s, pm2-studenthub: %s\n' "$([ -f /etc/cron.d/studenthub ] && echo ya || echo BELUM)" \
    "$(systemctl is-active pm2-studenthub.service 2>/dev/null || true)"
  allow="$(sshd -T 2>/dev/null | grep -Ei '^(allowusers|allowgroups) ' || true)"
  if [ -n "$allow" ] && ! grep -qw "$APP_USER" <<<"$allow"; then
    warn "sshd membatasi login ($allow) — tambahkan $APP_USER agar deploy SSH bisa masuk"
  fi
  log "langkah berikut: docs/deploy/BOOTSTRAP.md (situs & SSL aaPanel, fase nginx, secret GitHub, deploy pertama)"
}

run_phases() {
  local phase
  for phase in "$@"; do
    log "== fase $phase =="
    "phase_$phase"
  done
}

main() {
  local requested=("$@") phase candidate known
  for phase in "${requested[@]}"; do
    known=0
    for candidate in "${ALL_PHASES[@]}"; do [ "$phase" = "$candidate" ] && known=1; done
    [ "$known" -eq 1 ] || die "fase tidak dikenal: $phase (pilihan: ${ALL_PHASES[*]})"
    [ "$phase" != db ] || DB_REQUIRED=1
  done
  [ "${#requested[@]}" -gt 0 ] || requested=("${ALL_PHASES[@]}")
  WORK_DIR="$(mktemp -d)"
  trap cleanup EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  [ "${requested[0]}" = preflight ] || phase_preflight
  run_phases "${requested[@]}"
}

main "$@"
