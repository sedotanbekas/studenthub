# A2 — Konfirmasi identitas sebelum absen (spec)

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `A2-identity-confirm.critique.md`. Semua temuan diterima:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | `NOT_ME_NOTICE`: judul "Akun sebelumnya sudah keluar dari perangkat ini."; catatan menyebut akibat masuk di HP pinjaman (akun di HP sendiri keluar) dan `SHARED_DEVICE` yang benar (absen dua siswa dari HP sama di hari sama). |
| 2 | Notice dirender `div.info-message.login-notice` (judul di atas catatan); gaya di `shell.css`. |
| 3 | Baris di bawah "Ya, ini saya": "Setelah ini HP meminta izin lokasi & kamera untuk absen." |
| 4 | Transisi notice murni `nextLoginNotice(current, event)` (LOGIN/DEMO/LOGOUT/EXPIRED) + test; `studenthub:expired` juga mengosongkan notice; test browser keluar demo berikutnya → notice hilang. |
| 5 | Test browser memakai heading statis "Nyalakan lokasi dan kamera" dan nama dialog, bukan label tombol yang berubah. |
| 6 | `logout` tahu apakah sesi server berakhir; bila tidak → `OFFLINE_NOTICE` ("Akun belum keluar sepenuhnya… sambungkan internet lalu muat ulang"). |
| 7 | `GET /student/profile` dibatasi 5 detik (`AbortSignal.timeout`), gagal → kartu dengan nama saja. |
| 8 | `HubSession.logout` & `HubContextValue.logout` bertipe `(reason?: LogoutReason) => Promise<void>`. |
| 9 | `logout` dijaga ref `leaving` (ketukan ganda diabaikan, alasan pertama menang). |
| 10 | Koordinasi dicatat di `00-integration.md` §2.8 (urutan langkah logout dengan N1/N3); A1 dan A2 sama-sama mengubah `check-in-flow.tsx` (judul/langkah berbasis `identityConfirmed`). |
| 11 | "Bukan saya" ber-`aria-describedby` ke catatan akibat; NISN tersamar punya label lisan "NISN berakhiran 1234"; notice menjadi `aria-describedby` formulir masuk. |
| 12 | Entri backlog berupa bagian `###`. Coverage: logika di berkas `.ts` teruji; komponen `.tsx` di luar cakupan c8. |


## 1. Goal & non-goals

**Goal.** Absen tidak boleh lagi tercatat atas nama akun yang kebetulan masih masuk di HP pinjaman atau HP bersama saudara. Alur absen web (`CheckInFlow`) dibuka dengan kartu **"Absen sebagai <nama> · <kelas> · NISN ••••<4 digit>"** sebelum izin lokasi/kamera diminta. **"Ya, ini saya"** mengonfirmasi dan langsung meminta izin lokasi + kamera (ketukan yang sama dengan tombol "Izinkan lokasi & kamera" sekarang), jadi jumlah ketukan tidak bertambah. **"Bukan saya"** menutup alur, keluar lewat jalur logout yang sudah ada, lalu halaman masuk menampilkan penjelasan satu baris (satu HP = satu akun siswa; HP yang dipakai bergantian ditandai). Hanya frontend. Mode demo tetap jalan.

**Non-goals.** Tidak ada perubahan API, kontrak, POLICY, skema, atau migrasi (**tidak butuh migrasi**, jadi tidak ada folder `2026100307xxxx`). Tidak ada pencatatan ketukan "Bukan saya" di server (lihat §10). Ini bukan kontrol anti-kecurangan: siswa yang sengaja absen untuk temannya tetap bisa mengetuk "Ya". Untuk itu tetap mengandalkan selfie, `SHARED_DEVICE`, `DUPLICATE_SELFIE`, dan B1. Aplikasi Expo tidak diubah, hanya diberi rekomendasi di dokumentasi. Tidak menambah tombol "Batal": X di header dan Escape sudah membatalkan.

## 2. Existing code to reuse/change

| Path:line | Fakta | Perubahan |
|---|---|---|
| `src/components/hub/attendance/check-in-flow.tsx:39-77` | `CheckInFlow`. `useHub()` di :40, fokus heading di :51, judul di :63, hitungan langkah di :65, cabang `AccessGate` di :70 | Tambah langkah identitas sebelum `AccessGate` (§6) |
| `src/components/hub/attendance/access-gate.tsx:22` | Tombol memanggil `access.request()` | Tidak berubah. "Ya, ini saya" memanggil fungsi yang sama |
| `src/components/hub/attendance/device-access.ts:72-80, 82-89` | Kamera/GPS baru diminta lewat `request()`. Saat mount hanya memasang watcher izin | Tidak berubah. Kamera dijamin tidak terbuka sebelum konfirmasi |
| `src/components/hub/attendance/attendance-page.tsx:32-50` | `AttendancePage`. Pintasan `?absen=1` membuka alur otomatis (:37-42). Alur dipasang di :49 | Simpan konfirmasi per kunjungan halaman, berkunci user id (§6) |
| `src/components/hub/student-home.tsx:20` | Ubin "Absen" → `/hub/my-attendance?absen=1` | Tidak berubah. Gerbang ada di dalam alur, jadi pintasan ini ikut terjaga |
| `src/components/hub/context.tsx:5` | `logout: () => Promise<void>` | `logout: (reason?: LogoutReason) => Promise<void>` |
| `src/components/hub/use-session.ts:81, 93-128, 136-149, 156-167` | `logout` menjalankan splash, membersihkan demo, `POST /auth/logout` (bukan demo), `setMe(null)`, lalu `router.replace("/hub")`. Toast `notice` hilang setelah 4,5 detik (:126) | Tambah state `loginNotice` (tidak hilang sendiri): diisi oleh `logout(reason)`, dikosongkan oleh `login`/`startDemo` |
| `src/components/hub/hub.tsx:101` | `<Login …/>` tampil bila `!me` | Teruskan `notice={session.loginNotice}` |
| `src/components/hub/login.tsx:27-28, 53` | Props `Login` dan paragraf pembuka form | Prop opsional `notice`, dirender tepat di atas form (CTA-nya) |
| `src/components/hub/frame.tsx:27, 78` | Pemanggil `onLogout()` / `onExit()` tanpa argumen | Tetap kompatibel |
| `src/components/hub/splash.ts:256-262` | `playLogoutSplash` (elemen biasa, bukan top layer) | Alur `<dialog>` ditutup dulu sebelum logout (§9) |
| `src/lib/students/contracts.ts:186-195`, `queries.ts:98-126`, `auth/policy/students.ts:11` | `GET /api/v1/student/profile` → `name`, `nisn`, `className` (nullable), action `students.profile.read` (STUDENT ACTIVE/GRADUATED) | Dipakai apa adanya. Endpoint baru tidak perlu |
| `src/lib/frontend/demo.ts:38-47`, `demo-student.ts:92-95, 102`, `demo-personas.ts:31-33, 43` | `demoRows("/student/profile", persona)` mengembalikan profil persona. Persona non-siswa mendapat `[]` | Dipakai apa adanya |
| `src/lib/students/constants.ts:4` | `NISN_PATTERN = /^\d{10}$/` (murni, tanpa import) | Diimpor oleh file aturan baru |
| `src/lib/frontend/format.ts:15` | `initials()` | Avatar di kartu |
| `src/lib/attendance/anomaly-rules.ts:45, 61`; `src/lib/auth/device.ts:8` | `SHARED_DEVICE` (HIGH, "Perangkat yang sama dipakai siswa lain hari ini"). Satu akun aktif per perangkat absen | Dasar kebenaran teks penjelasan |
| `src/styles/student.css:66-68` | `.checkin-step-body`, `.step-actions` | Tambah gaya `.identity-*` |

## 3. Data model

Tidak ada perubahan. Tidak ada delta Prisma, tidak ada `migration.sql`, tidak ada folder migrasi. Data yang dibutuhkan (`User.name`, `Student.nisn` `@db.Char(10)` di `prisma/schema/student.prisma:20`, `currentClass.name`) sudah dikirim `GET /student/profile` dan `GET /auth/me`.

## 4. Pure rules

File baru `src/lib/frontend/identity-confirm-rules.ts` (tanpa React/Prisma), ditemani `identity-confirm-rules.test.ts`. **Tulis testnya dulu.**

```ts
export const NISN_MASK = "••••";            // U+2022 ×4
export const NISN_VISIBLE_DIGITS = 4;
export interface IdentityFacts { readonly className: string | null; readonly maskedNisn: string | null }
export const EMPTY_FACTS: IdentityFacts;     // { className: null, maskedNisn: null }
export type LogoutReason = "NOT_ME";
export interface LoginNotice { readonly title: string; readonly note: string }

/** NISN 10 digit (setelah trim) -> "••••" + 4 digit terakhir; selain itu null (tidak pernah membuka NISN utuh). */
export function maskNisn(nisn: unknown): string | null;
/** Ambil kelas & NISN tersamar dari data GET /student/profile atau demoRows (unknown, gagal tertutup -> EMPTY_FACTS). */
export function identityFacts(profile: unknown): IdentityFacts;
/** Teks kartu: nama dirapikan + baris fakta "X IPA 1 · NISN ••••5432" (bagian kosong dibuang). */
export function identityCard(name: string, facts: IdentityFacts): { readonly name: string; readonly facts: string };
/** Pesan halaman masuk setelah logout; tanpa alasan -> null. */
export function logoutNotice(reason?: LogoutReason): LoginNotice | null;
```

Konstanta teks:
- `NOT_ME_NOTICE = { title: "Akun sebelumnya sudah keluar dari HP ini.", note: "Masuk dengan NISN-mu sendiri. HP yang dipakai siswa lain di hari yang sama ditandai untuk diperiksa admin sekolah." }`. Nama akun sengaja tidak ditampilkan di halaman masuk.

Test `node:test` (`identity-confirm-rules.test.ts`):
1. `maskNisn("0098765432")` → `"••••5432"`, dan `maskNisn(" 0098765432 ")` → `"••••5432"`.
2. `maskNisn` menghasilkan `null` untuk `""`, `"12345"`, `"00987654321"`, `"00987a5432"`, `null`, `undefined`, `98765432`.
3. `identityFacts({ className: "X IPA 1", nisn: "0098765432", name: "…" })` → `{ className: "X IPA 1", maskedNisn: "••••5432" }`, dan `JSON.stringify` hasilnya tidak memuat `"0098765432"`.
4. `identityFacts`: `className` bernilai `null`, `"  "`, atau angka menjadi `null`. Masukan `[]` (demo non-siswa), `null`, dan `"x"` menjadi `EMPTY_FACTS`.
5. `identityCard(" Alya Putri ", full)` → `{ name: "Alya Putri", facts: "X IPA 1 · NISN ••••5432" }`. Tanpa kelas → `"NISN ••••5432"`. `EMPTY_FACTS` → `""`.
6. `logoutNotice("NOT_ME")` sama persis dengan `NOT_ME_NOTICE`, dan `logoutNotice()` → `null`.

Tambahan di `src/lib/frontend/demo.test.ts`: untuk tiap persona `STUDENT`, `STUDENT_BIMA`, dan `STUDENT_CITRA`, `identityFacts(demoRows("/student/profile", persona))` harus menghasilkan `className === persona.className` dan `maskedNisn === "••••" + nisn.slice(-4)` milik `demoStudents` persona itu. Untuk `demoPersona("SCHOOL_ADMIN")` hasilnya `EMPTY_FACTS`.

## 5. API

Tidak ada endpoint baru dan tidak ada perubahan kontrak. Yang dipakai:
- `GET /api/v1/student/profile` (`getOwnStudentProfile`, action `students.profile.read`, STUDENT). Kegagalan apa pun (jaringan, 403, 404) tidak memblokir: kartu tetap tampil dengan nama saja.
- `POST /api/v1/auth/logout` lewat `logout()` yang sudah ada (`use-session.ts:163`).

Tidak ada `withTx`, audit, atau notifikasi. `docs/openapi.json` dan `catalog.json` tidak berubah, jadi `pnpm openapi:export` dan `frontend:sync` tidak perlu dijalankan.

## 6. UI changes

**Komponen baru `src/components/hub/attendance/identity-step.tsx`** (< 80 baris):
- `useIdentityFacts(): IdentityFacts | undefined`. Data demo: `Promise.resolve(demoRows("/student/profile", demoPersonaForUser(me.user.id)))`. Data asli: `api("/student/profile").then(r => r.data)`. Lalu `.then(identityFacts, () => EMPTY_FACTS)` dan disimpan sebagai `{ userId, value }`. `undefined` (= memuat) dikembalikan selama `userId` belum sama dengan `me.user.id`. `setState` hanya di callback promise, mengikuti pola `student-home.tsx:36-42`, dengan penjaga `active`.
- `IdentityStep({ onConfirm, onNotMe })`:
  - `section.checkin-step-body.identity-step`, `aria-labelledby="identity-name"`.
  - `div.identity-card`: `span.avatar` berisi `initials(me.user.name)`, `span.kicker` "Absen sebagai", `h2#identity-name` = `card.name`, lalu `p.identity-facts` yang berisi `card.facts`, atau "Memuat kelas & NISN…" (kelas `muted`) saat `undefined`. Baris ini selalu dirender (`min-height`) agar tombol tidak bergeser.
  - `p.identity-note` "Kehadiran akan tercatat atas nama ini."
  - `div.step-actions` berisi:
    - `button.button.primary.block.large` (ikon `check`) "Ya, ini saya" → `onConfirm`
    - `button.button.secondary.block` (ikon `logout`) "Bukan saya" → `onNotMe`
    - tepat di bawahnya `small.identity-note` "Akun ini akan keluar dari HP ini." (sebab → akibat, menempel pada CTA)
  - Kedua tombol aktif sejak awal, tidak menunggu profil.

**`check-in-flow.tsx`:**
- Props baru: `identityConfirmed: boolean; onIdentityConfirmed: () => void`.
- `const { demo, logout } = useHub();`
- Judul (:63): `!identityConfirmed ? "Konfirmasi akun" : <logika lama>`. Nama dialog untuk aksesibilitas ikut berubah.
- Hitungan dan bar langkah (:65-66) hanya tampil bila `identityConfirmed && access.ready && step !== "done"` (identitas bukan langkah bernomor).
- Fokus (:51): dependensi ditambah `identityConfirmed`.
- Konten (:70): `!identityConfirmed ? <IdentityStep onConfirm={() => { onIdentityConfirmed(); void access.request(); }} onNotMe={() => { onClose(); void logout("NOT_ME"); }} /> : !access.ready ? <AccessGate …/> : …`
- Info demo (:68) dan catatan mode uji (:69) tetap tampil di atas kartu.

**`attendance-page.tsx`:** `const { me } = useHub(); const [confirmedFor, setConfirmedFor] = useState<string | null>(null);` lalu teruskan `identityConfirmed={confirmedFor === me.user.id}` dan `onIdentityConfirmed={() => setConfirmedFor(me.user.id)}`. Menutup lalu membuka alur lagi di kunjungan yang sama tidak bertanya ulang. Muat ulang atau masuk lagi ke halaman akan bertanya lagi. Ganti persona demo juga bertanya lagi.

**Sesi & login:**
- `use-session.ts`: `useSessionState` menambah `const [loginNotice, setLoginNotice] = useState<LoginNotice | null>(null)`. `logout(reason?)` menjalankan `setLoginNotice(logoutNotice(reason))` bersama `setMe(null)` (logout biasa menghapus notice lama). `login` dan `startDemo` menjalankan `setLoginNotice(null)`. `HubSession` menambah `readonly loginNotice: LoginNotice | null`. Jaga `useHubSession` di bawah 50 baris efektif (aturan lint `max-lines-per-function` berstatus warn).
- `login.tsx`: `notice?: LoginNotice | null`. Setelah `<p>Masuk dengan NISN…</p>`: `{notice && <p className="info-message" role="status"><strong>{notice.title}</strong><span>{notice.note}</span></p>}`.

**CSS (`src/styles/student.css`):**
- `.identity-card`: flex kolom, rata tengah, `gap:6px`, `padding:24px 16px`, `border:2px solid var(--line)`, `border-radius:20px`, `background:var(--paper)`.
- `.identity-card .avatar`: 64 px, font 22 px.
- `.identity-card h2`: `overflow-wrap:anywhere`.
- `.identity-facts`: `min-height:1.5em; font-weight:700`.
- `.identity-note`: `text-align:center; color:var(--muted); font-size:14px`.

**Demo.** Profil diambil dari persona (Alya: "X IPA 1 · NISN ••••5432"). "Ya" berjalan seperti aslinya (izin nyata, lokasi simulasi). "Bukan saya" memanggil `logout` mode demo (`clearDemoStorage`, tanpa panggilan server) → halaman masuk dengan notice dan pemilih demo. Memilih persona lagi akan menghapus notice.

## 7. Tests

- **Unit:** §4 (`identity-confirm-rules.test.ts` baru + kasus di `demo.test.ts`). Coverage c8 hanya menghitung `src/**/*.ts`, dan file aturan ini tercakup 100%.
- **Integration:** tidak ada yang baru. `tests/integration/students/crud.test.ts:323-348` sudah mengunci `name`, `nisn`, `className`, dan 403 untuk admin. Perilaku `/auth/logout` sudah diuji di `tests/integration/auth/sessions.test.ts`.
- **E2E (`e2e/*`, API-level):** tidak berubah.
- **Browser (`pnpm test:frontend`, `tests/browser/*`) wajib diperbarui karena kalau tidak akan merah:**
  - `frontend.spec.ts:121-138`: setelah ubin "Absen", harapkan dialog `{ name: "Konfirmasi akun" }` berisi "Alya Putri Ramadhani" dan "X IPA 1 · NISN ••••5432". Belum boleh ada tombol `/izinkan/i`. Klik "Ya, ini saya" → dialog `{ name: "Izinkan perangkat" }` tampil, tombol `/izinkan/i` terlihat (labelnya bisa "Coba izinkan lagi" karena Playwright menolak izin), dan "Lanjut ke foto wajah" berjumlah 0. Tutup alur, buka lagi lewat "Absen sekarang" → langsung "Izinkan perangkat" (konfirmasi diingat).
  - Test baru di `frontend.spec.ts`: "siswa (demo): Bukan saya mengeluarkan akun dan menjelaskan di halaman masuk". Alya → Absen → "Bukan saya" → heading "Senang bertemu lagi." dan teks "Akun sebelumnya sudah keluar dari HP ini." terlihat, banner demo hilang → klik "Masuk demo sebagai Siswa · Bima" → teks notice berjumlah 0.
  - `page-slide-scenario.ts:103`: `"Izinkan perangkat"` → `"Konfirmasi akun"`.

## 8. Docs to update

- `docs/PLAN.md` bagian Absensi, bullet baru setelah :199-202: "**Konfirmasi identitas sebelum absen (pemilik 2026-10-03):** alur absen web diawali kartu 'Absen sebagai <nama> · <kelas> · NISN ••••<4 digit>'. 'Ya, ini saya' lanjut ke izin lokasi & kamera, 'Bukan saya' mengeluarkan akun dari HP itu (logout biasa) dan halaman masuk menjelaskan bahwa HP yang dipakai siswa lain ditandai (`SHARED_DEVICE`). Hanya frontend, tanpa perubahan API. Mencegah salah akun, bukan kecurangan yang disengaja." Daftar "Ditunda" tidak berubah.
- `docs/FRONTEND.md`:
  - :75 "Alur absen (layar penuh) diawali layar izin" → "diawali kartu konfirmasi akun, lalu layar izin".
  - Bullet baru **Konfirmasi akun** setelah :75 (isi §6, termasuk diingat per kunjungan halaman dan notice di halaman masuk).
  - :81 Demo: tambahkan "'Bukan saya' keluar dari demo ke halaman masuk dengan penjelasan".
  - :98: tambahkan `src/lib/frontend/identity-confirm-rules.ts` (masker NISN, teks kartu, pesan keluar) + test.
- `docs/integration/expo.md` §5 (dekat :150 "sebelum membuka kamera"): rekomendasi untuk aplikasi agar menampilkan konfirmasi yang sama (nama dari `/auth/me`, kelas + NISN dari `GET /student/profile` disamarkan 4 digit terakhir), dengan "Bukan saya" → `POST /auth/logout`. Ditambah item checklist §15 yang sesuai.
- `docs/backlog.md` "Tambahan dari implementasi": "**Jejak 'Bukan saya'**. Ketukan tidak dicatat server. Kerjakan bila admin sekolah perlu melihat pola HP pinjaman di luar `SHARED_DEVICE`."
- `docs/design/02-attendance.md`: tidak berubah (PLAN yang berlaku, tidak ada perubahan API).

## 9. Edge cases & risks

| Kasus | Penanganan |
|---|---|
| `<dialog>` modal ada di top layer, di atas splash logout | `onNotMe` memanggil `onClose()` dulu (dialog dilepas) baru `logout("NOT_ME")`. Dialog yang hilang juga mencegah ketukan ganda (HRIS memakai ref `sedangKeluar`). Splash sendiri sudah dijaga `state().kind` |
| Kamera terbuka sebelum konfirmasi | Mustahil: `request()` hanya dipanggil dari "Ya" atau tombol AccessGate (`device-access.ts:72-89`) |
| Pintasan `?absen=1` melewati gerbang | Gerbang ada di dalam `CheckInFlow`, bukan di tombol (pelajaran HRIS daf1315) |
| Profil lambat/gagal/offline | Kartu langsung memakai `me.user.name`, baris fakta berisi placeholder lalu kosong. Tidak pernah memblokir |
| Ketukan "Bukan saya" tak sengaja | Tombol sekunder di bawah tombol utama, akibat tertulis di bawahnya. Kerugiannya hanya masuk ulang. Tanpa dialog konfirmasi kedua (friksi) |
| Privasi | Hanya 4 digit NISN yang tampil. Halaman masuk tidak menyebut nama akun sebelumnya |
| Ganti persona demo saat halaman tetap terpasang | Konfirmasi berkunci `me.user.id` |
| Notice basi | Dihapus oleh `login`, `startDemo`, dan setiap logout tanpa alasan. Hilang saat muat ulang (state memori) |
| Pemilik asli lalu masuk di HP pinjaman | Aturan yang sudah ada berlaku: perangkat diikat ulang dan sesi perangkat lain dicabut (`device.ts:8`), absen ditandai `SHARED_DEVICE` bila HP dipakai dua siswa di hari yang sama. Teks notice menyatakannya |
| Kecurangan sengaja | Di luar cakupan. Selfie, `SHARED_DEVICE`, `DUPLICATE_SELFIE`, dan B1 yang menangani |
| Escape / X saat kartu tampil | Sama dengan "Batal": alur tertutup tanpa logout |
| `logout` API gagal | Fallback `endServerSession()` yang sudah ada (`use-session.ts:163`) |

Pelajaran HRIS: (1) gerbang dipasang di fungsi pemicu alur agar jalur pintasan ikut terjaga; (2) "Bukan saya" langsung logout; (3) logout harus aman dari ketukan ganda. Yang sengaja tidak ditiru: HRIS hanya menampilkan nama, di sini ditambah kelas + NISN tersamar agar saudara dengan nama mirip tetap bisa dibedakan. Tombol Batal ketiga tidak ditiru karena X/Escape sudah ada. HRIS bertanya di setiap ketukan, di sini konfirmasi diingat per kunjungan halaman dan disatukan dengan permintaan izin, jadi tidak ada ketukan tambahan.

## 10. Open questions (dengan default)

1. **Tanya ulang setiap kali alur dibuka?** Default: tidak. Konfirmasi diingat selama kunjungan halaman dan ditanyakan lagi setelah muat ulang atau masuk lagi ke halaman.
2. **Catat "Bukan saya" di server (riwayat masuk/anomali)?** Default: tidak, hanya frontend, dan dicatat sebagai item backlog.
3. **Wajibkan juga di aplikasi Expo?** Default: hanya rekomendasi di `expo.md`, tidak dipaksa API.
