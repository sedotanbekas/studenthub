# Bootstrap VPS Student Hub (sekali jalan)

Panduan penyiapan awal VPS medialab (`38.47.176.211`, Ubuntu 24.04 + aaPanel) untuk Student Hub
produksi & staging. Setelah bootstrap selesai, setiap push ke `master` men-deploy otomatis lewat
`.github/workflows/ci-cd.yml` (gerbang → staging → produksi).

Bagian yang bisa diotomatiskan dikerjakan **`scripts/deploy/bootstrap-vps.sh`** (root, idempoten,
aman diulang). Langkah yang butuh UI atau komputer lokal (DNS, situs & SSL aaPanel, secret GitHub)
tetap manual.

## Ringkasan lingkungan

| | Produksi | Staging (data demo) |
| --- | --- | --- |
| Domain | `studenthub.medialab.co.id` | `staging.studenthub.medialab.co.id` |
| Port app (hanya 127.0.0.1) | 3030 | 3031 |
| Folder aplikasi | `/www/wwwroot/studenthub` | `/www/wwwroot/studenthub-staging` |
| Storage (`STORAGE_ROOT`) | `/www/wwwroot/studenthub-storage` | `/www/wwwroot/studenthub-storage-staging` |
| Database / user MariaDB | `studenthub` / `studenthub` | `studenthub_staging` / `studenthub_staging` |
| Proses PM2 | `studenthub` | `studenthub-staging` |
| Backup pra-migrasi (simpan 14) | `/home/studenthub/backups/production` | `/home/studenthub/backups/staging` |
| Backup harian 03:30 WIB | `/home/studenthub/backups/production/daily` (DB 14, storage 7) | — |
| Konfigurasi curl job | `/etc/studenthub/curl-job-production.conf` | `/etc/studenthub/curl-job-staging.conf` |

Port dan path ini juga tertulis di `ecosystem.config.cjs`, `scripts/deploy/remote-deploy.sh`,
`scripts/deploy/bootstrap-vps.sh`, `docs/deploy/nginx-*.conf`, dan `docs/deploy/studenthub.cron` —
ubah semuanya bersamaan bila perlu.

## Model keamanan

- Aplikasi, PM2, deploy SSH, cron tick, dan backup berjalan sebagai **user sistem `studenthub`**
  (bukan root). RCE di aplikasi tidak menjadi root di VPS yang juga menampung aplikasi klien lain.
- PM2 milik user itu sendiri (`PM2_HOME=/home/studenthub/.pm2`), dijalankan unit systemd
  `pm2-studenthub.service` (`docs/deploy/pm2-studenthub.service`, dengan `NoNewPrivileges`,
  `ProtectSystem=full`, `PrivateTmp`).
- Kunci deploy GitHub Actions khusus (ed25519) dipasang dengan opsi `restrict` (tanpa forwarding
  port/agent/X11, tanpa PTY) dan hanya untuk user `studenthub`.
- nginx (user `www`) hanya bisa menelusuri root storage dan membaca `public/` (grup `www`);
  `private/` dan `tmp/` bermode 0700 milik `studenthub`.
- Rahasia hanya ada di `.env` (0600) dan `/etc/studenthub/curl-job-*.conf` (0600); tidak pernah
  di-commit, dicetak skrip, atau lewat argumen proses.

---

## Langkah 0 — Prasyarat & urutan

1. **DNS**: A record `studenthub.medialab.co.id` dan `staging.studenthub.medialab.co.id` →
   `38.47.176.211`. (Tanpa DNS aplikasi tetap bisa di-deploy; hanya SSL & akses publik tertunda.)
2. Akses SSH root ke VPS (operator) dan `gh` di komputer lokal sudah login sebagai `sedotanbekas`.
3. **Urutan yang dianjurkan:** bootstrap VPS (langkah 1–3) **sebelum** merge pertama ke `master`.
   Bila merge terjadi lebih dulu, job deploy gagal aman di preflight (“bukan checkout git”);
   setelah bootstrap selesai cukup **Re-run failed jobs** di tab Actions.
4. Branch yang di-clone harus sudah memuat `scripts/deploy/` dan `docs/deploy/`. Bila `master`
   belum memuatnya, jalankan bootstrap dengan `STUDENTHUB_BRANCH=<branch fitur>`; deploy berikutnya
   tetap memasang sha `master` yang lulus gerbang.

## Langkah 1 — Kunci deploy & secret GitHub (komputer lokal, Git Bash)

```bash
# Kunci khusus deploy; kunci privat hanya disimpan sebagai secret GitHub.
ssh-keygen -t ed25519 -N "" -C "github-actions-studenthub-deploy" -f ./studenthub_deploy
gh secret set VPS_SSH_KEY  --repo sedotanbekas/studenthub < ./studenthub_deploy
gh secret set VPS_HOST     --repo sedotanbekas/studenthub --body "38.47.176.211"
gh secret set VPS_USERNAME --repo sedotanbekas/studenthub --body "studenthub"
scp ./studenthub_deploy.pub root@38.47.176.211:/root/studenthub_deploy.pub
rm -f ./studenthub_deploy ./studenthub_deploy.pub
```

**Disarankan — verifikasi host key (anti-MITM):** `appleboy/ssh-action` (klien SSH Go) memilih host
key **ECDSA** lebih dulu daripada RSA/ED25519, jadi pakai sidik jari ECDSA:

```bash
ssh root@38.47.176.211 "ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub" | awk '{print $2}'
gh secret set VPS_SSH_FINGERPRINT --repo sedotanbekas/studenthub --body "SHA256:<hasil di atas>"
```

Bila VPS tidak punya kunci ECDSA, pakai `ssh_host_rsa_key.pub`, lalu `ssh_host_ed25519_key.pub`.
Bila deploy gagal dengan `host key fingerprint mismatch`, periksa kunci yang dipakai atau hapus
secret ini (verifikasi dilewati).

| Secret | Isi |
| --- | --- |
| `VPS_HOST` | `38.47.176.211` |
| `VPS_USERNAME` | `studenthub` |
| `VPS_SSH_KEY` | kunci privat ed25519 di atas (utuh, termasuk baris BEGIN/END) |
| `VPS_SSH_FINGERPRINT` | opsional, `SHA256:…` host key ECDSA VPS |

## Langkah 2 — Jalankan `bootstrap-vps.sh` (VPS, root)

```bash
# Dari komputer lokal (checkout repo):
scp scripts/deploy/bootstrap-vps.sh root@38.47.176.211:/root/bootstrap-vps.sh

# Di VPS sebagai root. Buang CR bila checkout Windows (core.autocrlf) mengubah akhir baris.
sed -i 's/\r$//' /root/bootstrap-vps.sh
# Kredensial root MariaDB dari aaPanel > Databases > Root password.
# Berkas ini dibuat 0600 dan dihapus setelah selesai; password TIDAK diketik di baris perintah.
install -m 600 /dev/null /root/.studenthub-dbroot.cnf
nano /root/.studenthub-dbroot.cnf
#   [client]
#   user=root
#   password="<password root MariaDB>"

DEPLOY_PUBKEY_FILE=/root/studenthub_deploy.pub \
DB_ROOT_CNF=/root/.studenthub-dbroot.cnf \
  bash /root/bootstrap-vps.sh

shred -u /root/.studenthub-dbroot.cnf
```

Tanpa `DB_ROOT_CNF`, skrip menanyakan password root tanpa gema (bila dijalankan di terminal).
Fase bisa dijalankan terpisah, mis. `bash /root/bootstrap-vps.sh db jobconf` (preflight selalu
jalan lebih dulu). Fase `nginx` baru berguna setelah situs aaPanel dibuat (langkah 5).

| Fase | Yang dikerjakan (setara manual) |
| --- | --- |
| `preflight` | Cek root, alat (`git curl openssl flock sudo …`), Node aaPanel + corepack, grup `www`. |
| `user` | `useradd --system --create-home --shell /bin/bash studenthub`; password `*` (login hanya kunci SSH); pasang kunci deploy ke `~studenthub/.ssh/authorized_keys` dengan prefiks `restrict`. |
| `tooling` | Sebagai `studenthub`: `corepack enable --install-directory ~/.local/bin pnpm`, `corepack install -g pnpm@10.15.0`, `npm install -g --prefix ~/.local pm2`; PATH operator di `~/.bashrc`. |
| `dirs` | Folder aplikasi (0750), storage (root 0750 & `public/` 2755 bergrup `www`; `private/` & `tmp/` 0700), backup (0700), `/var/log/studenthub`, `/etc/studenthub` (root:studenthub 0750). |
| `clone` | `git clone --depth 50 --branch master https://github.com/sedotanbekas/studenthub.git` ke kedua folder aplikasi (sebagai `studenthub`). |
| `env` | Membuat `.env` 0600 per lingkungan dengan rahasia acak (`openssl rand -hex`). `.env` yang sudah ada **tidak pernah ditimpa**. |
| `db` | `CREATE DATABASE … utf8mb4_unicode_ci`, user untuk `127.0.0.1` dan `localhost`, password dari `.env`, `GRANT ALL ON <db>.*`, lalu uji login TCP. SQL dikirim lewat stdin. |
| `jobconf` | `/etc/studenthub/curl-job-<env>.conf` (0600, milik studenthub) berisi `header = "X-Job-Secret: …"` dari `JOB_SECRET` di `.env`. Jalankan ulang bila `JOB_SECRET` diganti. |
| `cron` | Pasang `docs/deploy/studenthub.cron` → `/etc/cron.d/studenthub` dan `docs/deploy/logrotate-studenthub` → `/etc/logrotate.d/studenthub`. |
| `pm2` | Pasang `docs/deploy/pm2-studenthub.service`, `systemctl enable --now pm2-studenthub`, modul `pm2-logrotate` (20 MB, simpan 14). |
| `nginx` | Salin `docs/deploy/nginx-*.conf` ke `/www/server/panel/vhost/nginx/extension/<domain>/studenthub.conf`, `nginx -t` (gagal → dikembalikan), reload. |
| `summary` | Ringkasan status tanpa rahasia + peringatan bila `sshd` membatasi `AllowUsers`. |

## Langkah 3 — Isi `.env` (dibuat fase `env`)

Satu berkas per folder aplikasi, pemilik `studenthub`, mode **0600**, tidak pernah di-commit.
Semua variabel `.env.example`:

| Variabel | Produksi | Staging |
| --- | --- | --- |
| `DATABASE_URL` | `mysql://studenthub:<hex48>@127.0.0.1:3306/studenthub` | `mysql://studenthub_staging:<hex48>@127.0.0.1:3306/studenthub_staging` |
| `SHADOW_DATABASE_URL` | tidak dipakai (hanya `prisma migrate dev` lokal) | tidak dipakai |
| `JWT_ACCESS_SECRET` / `AD_EVENT_SECRET` / `JOB_SECRET` | masing-masing `openssl rand -hex 32`, saling berbeda | idem (berbeda dari produksi) |
| `TOTP_ENC_KEY` | `openssl rand -hex 32` (tepat 32 byte; hex 64 karakter atau base64), berbeda dari rahasia lain — kunci AES-256-GCM rahasia TOTP super admin | idem (berbeda dari produksi) |
| `APP_ORIGIN` | `https://studenthub.medialab.co.id` | `https://staging.studenthub.medialab.co.id` |
| `PUBLIC_MEDIA_BASE_URL` | `https://studenthub.medialab.co.id/media` | `https://staging.studenthub.medialab.co.id/media` |
| `STORAGE_ROOT` | `/www/wwwroot/studenthub-storage` | `/www/wwwroot/studenthub-storage-staging` |
| `PUSH_TRANSPORT` | `log` (ganti `expo` setelah proyek EAS siap) | `log` |
| `EXPO_ACCESS_TOKEN` | kosong (isi bila Enhanced Push Security aktif) | kosong |
| `DOCS_BASIC_AUTH` | `docs:<hex24>` (wajib di produksi) | `docs:<hex24>` |
| `LOG_LEVEL` | `info` | `info` |
| `DEMO_PASSWORD` | — (seed demo tidak pernah jalan di produksi) | `Demo<hex12>7` (akun demo `db:seed:demo`) |

`NODE_ENV`, `TZ=UTC`, dan `APP_VERSION` (sha git) diatur PM2 lewat `ecosystem.config.cjs`, bukan
`.env`. Password hex tidak perlu di-URL-encode.

Membaca satu nilai tanpa menampilkan seluruh berkas (mis. untuk membuka `/docs`):

```bash
sudo -u studenthub grep '^DOCS_BASIC_AUTH=' /www/wwwroot/studenthub/.env
```

Setelah mengubah `.env`: `sudo -iu studenthub pm2 restart studenthub` (atau `studenthub-staging`).
Bila `JOB_SECRET` diubah, jalankan juga `bash /root/bootstrap-vps.sh jobconf`.

**`TOTP_ENC_KEY` (sejak P5).** `.env` yang dibuat sebelum P5 belum memuatnya, dan app gagal start
tanpa kunci ini (`remote-deploy.sh` menolak deploy lebih awal). Sebelum merge P5 ke `master`, jalankan
sebagai root `bash /root/bootstrap-vps.sh env` — fase ini hanya **menambahkan** `TOTP_ENC_KEY` acak di
ujung `.env` yang belum memilikinya (baris lain tidak disentuh, nilai tidak dicetak) — lalu
`sudo -iu studenthub pm2 restart studenthub` dan `studenthub-staging`. **Jangan mengganti kunci ini**
setelah ada super admin yang mendaftarkan TOTP: rahasia lama tak bisa didekripsi sehingga super admin
tidak bisa login; pulihkan dengan `sudo -iu studenthub bash -c 'cd /www/wwwroot/studenthub && pnpm db:totp-reset --email <email>'`.

**Membuat database manual** (bila tidak memakai fase `db`), sebagai root MariaDB:

```sql
CREATE DATABASE IF NOT EXISTS `studenthub` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'studenthub'@'127.0.0.1' IDENTIFIED BY '<hex dari .env>';
CREATE USER IF NOT EXISTS 'studenthub'@'localhost' IDENTIFIED BY '<hex dari .env>';
GRANT ALL PRIVILEGES ON `studenthub`.* TO 'studenthub'@'127.0.0.1', 'studenthub'@'localhost';
FLUSH PRIVILEGES;
```

User dibuat untuk `127.0.0.1` **dan** `localhost` karena MariaDB mencocokkan `'user'@'localhost'`
hanya untuk koneksi socket, sedangkan `DATABASE_URL` memakai TCP. Ulangi untuk staging.

## Langkah 4 — Deploy pertama

Cara utama: push/merge ke `master` (atau **Re-run failed jobs**). Deploy manual sebagai `studenthub`:

```bash
sudo -iu studenthub
cd /www/wwwroot/studenthub-staging
git fetch --depth 50 origin master && git reset --hard FETCH_HEAD
bash scripts/deploy/remote-deploy.sh staging
# ulangi di /www/wwwroot/studenthub dengan argumen production
```

`remote-deploy.sh`: preflight → `pnpm install --frozen-lockfile` → penjaga nama DB → backup DB
(database kosong dilewati) → `prisma migrate deploy` → (staging) seed demo → build di bawah
`flock /tmp/studenthub-build.lock` → `pm2 startOrReload` → poll `/api/health` sampai `version` =
sha yang dipasang.

**Super admin pertama** (setelah skrip `db:super-admin` tersedia di fase P1), di folder produksi:

```bash
sudo -iu studenthub
cd /www/wwwroot/studenthub && pnpm db:super-admin
```

**TOTP 2FA super admin (sejak P5).** Setelah login pertama dan ganti kata sandi, setiap super admin
wajib mendaftarkan TOTP: `POST /api/v1/me/totp/setup` (rahasia + `otpauthUri`, tampil sekali; pindai
dengan Google Authenticator/Aegis/1Password) lalu `POST /api/v1/me/totp/confirm {"code":"123456"}`.
Sebelum itu semua aksi `/platform/*` ditolak `403 TOTP_ENROLLMENT_REQUIRED`; setelahnya login wajib
`totpCode`. HP autentikator hilang → reset oleh operator (diaudit, semua sesi akun dicabut):

```bash
sudo -iu studenthub
cd /www/wwwroot/studenthub && pnpm db:totp-reset --email admin@medialab.co.id
```

Super admin demo staging (`superadmin@…` dari seed demo) juga didaftarkan manual sekali; seed tidak
pernah membuat atau menimpa rahasia TOTP.

## Langkah 5 — nginx & SSL (aaPanel)

Untuk **setiap** domain (produksi & staging):

1. aaPanel → **Website → Add site**: domain `studenthub.medialab.co.id`; root biarkan bawaan
   `/www/wwwroot/studenthub.medialab.co.id` (**bukan** folder aplikasi — aaPanel mengubah pemilik
   root situs menjadi `www` dan menaruh `.user.ini` di sana); PHP **Static**; tanpa database/FTP.
2. **Jangan** aktifkan fitur *Reverse proxy*, *Cache*, atau *HSTS* bawaan aaPanel: potongan kita
   sudah memuat `location /` proxy dan header HSTS (duplikat = konflik/berulang).
3. Tab **SSL** → Let's Encrypt (setelah DNS mengarah ke VPS) → aktifkan **Force HTTPS**.
4. Pasang potongan: `bash /root/bootstrap-vps.sh nginx` (atau salin manual
   `docs/deploy/nginx-studenthub.conf` → `/www/server/panel/vhost/nginx/extension/studenthub.medialab.co.id/studenthub.conf`,
   lalu `/www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload`).

Isi potongan: `client_max_body_size 12m`, HSTS, header proxy (`Host`, `X-Real-IP $remote_addr`,
`X-Forwarded-Proto`), `proxy_http_version 1.1`, `proxy_cache off`, `proxy_read_timeout 60s`,
`location ^~ /api/internal/ { return 404; }`, `location ^~ /media/` alias ke `storage/public/`
(immutable, `nosniff`, CSP sandbox), serta `^~ /api/` & `^~ /_next/` agar location regex bawaan
aaPanel (`*.js`, `*.css`, gambar) tidak menyerobot request aplikasi. Port 3030/3031 **tidak**
perlu dibuka di firewall (app hanya mendengar 127.0.0.1).

## Langkah 6 — Cron, backup, log

- `/etc/cron.d/studenthub` (fase `cron`): tick per menit untuk produksi (:3030) & staging (:3031)
  sebagai user `studenthub` dengan `flock -n`, secret lewat `curl -K /etc/studenthub/curl-job-<env>.conf`;
  backup harian produksi 20:30 UTC (DB) dan 20:40 UTC (storage).
- Log cron/backup: `/var/log/studenthub/{cron,backup}.log` (logrotate mingguan, simpan 8).
  `cron.log` kosong = tick sehat. Log aplikasi: `sudo -iu studenthub pm2 logs studenthub`.
- Backup ada di disk yang sama dengan MariaDB — **salinan off-site masih pertanyaan terbuka**.
- Pemulihan DB: lihat komentar kepala `scripts/deploy/backup-db.sh`. Pemulihan storage: lihat
  `scripts/deploy/backup-storage.sh`.

## Langkah 7 — Verifikasi

```bash
curl -fsS http://127.0.0.1:3030/api/health            # di VPS: version = sha terakhir
curl -fsS https://studenthub.medialab.co.id/api/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://studenthub.medialab.co.id/api/internal/jobs/tick   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://studenthub.medialab.co.id/docs                             # 401 tanpa Basic auth
sudo -iu studenthub pm2 ls                              # studenthub & studenthub-staging online
systemctl is-active pm2-studenthub                      # active
ls -l /home/studenthub/backups/production               # backup pra-migrasi
sudo -u www test -r /www/wwwroot/studenthub-storage/public && echo "nginx bisa membaca public/"
sudo -u www test -r /www/wwwroot/studenthub-storage/private || echo "private/ tertutup untuk nginx"
```

Lalu jalankan skenario demo di staging (docs/PLAN.md § Verifikasi).

---

## Operasional

- **Rollback**: migrasi selalu aditif, jadi kode lama cocok dengan skema baru:
  `cd /www/wwwroot/studenthub && git fetch --depth 50 origin master && git reset --hard <sha-lama> && bash scripts/deploy/remote-deploy.sh production`
  (sebagai `studenthub`). Push berikutnya ke `master` memasang ulang versi terbaru.
- **Ganti versi Node**: ubah `NODE_BIN_DIR` bawaan di `scripts/deploy/common.sh` dan
  `bootstrap-vps.sh`, lalu `bash /root/bootstrap-vps.sh tooling pm2` dan `systemctl restart pm2-studenthub`.
- **Rotasi kunci deploy**: ulangi langkah 1 dengan kunci baru, hapus baris lama di
  `~studenthub/.ssh/authorized_keys`.
- **Repo dijadikan private**: `git fetch` HTTPS anonim berhenti bekerja. Pasang deploy key
  read-only khusus VPS:

  ```bash
  sudo -iu studenthub
  ssh-keygen -t ed25519 -N "" -C "vps-studenthub-readonly" -f ~/.ssh/github_studenthub
  ssh-keyscan github.com >> ~/.ssh/known_hosts
  printf 'Host github.com\n  IdentityFile ~/.ssh/github_studenthub\n  IdentitiesOnly yes\n' >> ~/.ssh/config
  chmod 600 ~/.ssh/config
  cat ~/.ssh/github_studenthub.pub   # lalu di lokal: gh repo deploy-key add <berkas.pub> --repo sedotanbekas/studenthub --title vps-studenthub
  git -C /www/wwwroot/studenthub remote set-url origin git@github.com:sedotanbekas/studenthub.git
  git -C /www/wwwroot/studenthub-staging remote set-url origin git@github.com:sedotanbekas/studenthub.git
  ```

## Pemecahan masalah

| Gejala | Penyebab & tindakan |
| --- | --- |
| `PENJAGA: .env … menunjuk database '…'` | `.env` folder itu menunjuk DB lingkungan lain. Perbaiki `DATABASE_URL`; deploy sengaja berhenti sebelum backup/migrasi. |
| `.env tidak ada` / `bukan checkout git` | Bootstrap (fase `dirs clone env`) belum dijalankan untuk folder itu. |
| `deploy … lain masih berjalan` | Deploy lain memegang `/tmp/studenthub-deploy-<env>.lock`; tunggu atau periksa proses yang menggantung. |
| Health tidak melaporkan versi | Lihat 80 baris log PM2 di output job; biasanya `.env` tidak valid (boot gagal) atau DB mati. |
| `Permission denied (publickey)` di Actions | Kunci publik belum di `authorized_keys` studenthub, atau `sshd` punya `AllowUsers`/`AllowGroups` tanpa `studenthub` (lihat fase `summary`). |
| `host key fingerprint mismatch` | `VPS_SSH_FINGERPRINT` bukan sidik jari host key yang dinegosiasikan (pakai ECDSA, lihat langkah 1). |
| `ruang disk bebas … < …` | Bersihkan disk; deploy menolak berjalan bila bebas < 3 GB (`DEPLOY_MIN_FREE_MB`). |
