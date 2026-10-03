# N2: Notification categories per admin account

## 0. Revisi setelah kritik (2026-10-03) — berlaku di atas draf di bawah

Sumber: `N2-notification-categories.critique.md`. Semua temuan diterima; yang mengubah desain:

| # Kritik | Keputusan (sudah diimplementasikan) |
|---|---|
| 1 | Kasus `chk_notification_mute_category` ditambahkan (`notificationCases` di `check-cases.ts`): SYSTEM ditolak, FINANCE lolos. |
| 2 | `SCHOOL_ADMIN_BROADCAST_TYPES` (PAYMENT_SUBMITTED, LEAVE_SUBMITTED, SCHOOL_SETTINGS_CHANGED, NISN_RELEASED — diturunkan ulang dari semua pemanggil; A1/B1 tidak menambah siaran admin) dan `notifySchoolAdmins(…, event: SchoolAdminBroadcastEvent)` bertipe: siaran baru wajib didaftarkan. Test: `ADMIN_MUTABLE_CATEGORIES` = kategori tipe siaran selain SYSTEM; setiap kategori punya petunjuk. ENUM migrasi disalin dari definisi terakhir. Kategori ATTENDANCE untuk N4 ditambahkan oleh N4 (keputusan integrasi 1) beserta petunjuknya. |
| 3 | Rute sekolah memakai `manageableTarget`: hanya admin tambahan; admin utama → 403 `PRIMARY_ADMIN_PROTECTED` dan mengatur miliknya lewat `/me/notification-preferences` (sesuai PLAN). |
| 4 | `SecurityCard`/`DEMO_MESSAGE` dipindah ke `security-card.tsx`; `NotificationCategoriesField` di berkas sendiri (tanpa siklus impor). |
| 5 | Tanpa perubahan `format.ts`; detail menampilkan "Tidak ada — semua kabar sekolah dikirim." untuk daftar kosong `mutedCategories`. |
| 6 | Catatan kaki ada di dalam field (tampil di kartu & dialog); toast aksi "Atur notifikasi" memakai `prefsSavedMessage`. |
| 7 | DTO `SchoolAdmin` menormalkan `mutedCategories` (kategori lama yang tak bisa dimatikan disembunyikan). |
| 8 | `BroadcastCandidate.reachable` (`isReachableAdmin`: pernah masuk & kata sandi sementara belum kedaluwarsa): bila tidak ada penerima tersisa yang bisa dijangkau, admin utama ikut menerima (atau semua kandidat bila tanpa admin utama). |
| 9 | `NotificationPreferences` memuat `updatedAt`/`updatedBy` dari audit terakhir; kartu menulis "Diatur oleh … pada …" bila diubah akun lain. |
| 10 | Dokumen desain 02 (LEAVE_SUBMITTED), 03 (PAYMENT_SUBMITTED), 05 (tabel peristiwa + aturan "N12. Mute kategori siaran admin (fitur N2)") diperbarui. |
| 11 | Rujukan baris dikoreksi saat implementasi; tombol "Atur" ada di bawah teks kartu; rujukan HRIS hanya latar (repo luar). |

Jawaban default §10 dipakai: cadangan admin utama; admin tambahan boleh mengatur miliknya sendiri; SYSTEM selalu
dikirim; kategori kehadiran (ATTENDANCE) menyusul di N4 sebagai kategori baru yang bisa dimatikan.


## 1. Goal & non-goals

**Goal.** Today every active SCHOOL_ADMIN gets every school-wide broadcast (`notifySchoolAdmins`, `src/lib/notifications/notify.ts:70-73`). That includes the extra admin accounts teachers use. This feature adds a per-account **mute list** of `NotificationCategory` values. The mute list applies only to the broadcast fan-out to school admins. An account with no rows receives everything, exactly as today, so the deploy changes nothing until someone chooses. Admins set their own list on the **Notifikasi** page. The primary admin, and a super admin through `?schoolId=`, can also set it for any admin account in **Admin & guru**. Filtering happens when rows are written, so the inbox, unread badge and push (N3) all agree automatically.

**Non-goals.** Personal notifications (`notifyUsers`/`notifyStudents`/`notifyRecipients` called directly) are never filtered. `SYSTEM` can never be muted. Super admin and sponsor broadcasts are not filtered. Old rows are not hidden and missed rows are not backfilled. There is no per-type or per-class filtering: "hanya kelas saya" needs a teacher↔class link, which is future work. There are no sub-roles or permission changes, and no digest/merging (still deferred in PLAN).

## 2. Existing code to reuse/change

| Where | What changes |
|---|---|
| `src/lib/notifications/notify.ts:70-73` | `notifySchoolAdmins` resolves the category, then loads mutes for that category only when it is mutable, then calls `selectBroadcastRecipients` (§4). Update the header comment at :6-9. |
| `src/lib/notifications/notify.ts:29-53` | Unchanged. Rows are already one per recipient (:34-45) and the push status is set per row (:42, :51). This is why write-time filtering also covers push. |
| `src/lib/notifications/notify.ts:75-78` | `notifySuperAdmins` is **unchanged**. All super-admin broadcasts map to SYSTEM (`AD_SUBMITTED`, `TOPUP_SUBMITTED`, `NISN_RELEASED`: `rules.ts:16,19,26`, callers `ads/ad-service.ts:137`, `ads/lifecycle-service.ts:68`, `sponsors/topup-service.ts:67`, `students/nisn-release-log.ts:99`). They are review queues only super admin can handle. |
| `src/lib/notifications/rules.ts:4-38` | Add the pure mute rules (§4). `CATEGORY_BY_TYPE` stays the source of truth: FINANCE is `PAYMENT_SUBMITTED` (:7), STUDENT_AFFAIRS is `LEAVE_SUBMITTED` (:10), SYSTEM is `NISN_RELEASED`/`SCHOOL_SETTINGS_CHANGED` (:26-27). |
| `src/lib/students/nisn-release-log.ts:74-85` | `notifyOriginSchools` bypasses `notifySchoolAdmins`, building the recipients itself (:77-78, :83-84). Keep the holder-name query, and replace the admin query and `notifyRecipients` with `notifySchoolAdmins(tx, schoolId, nisnReleasedNotification(info), ctx)` per school. Behavior is identical because SYSTEM is never muted, and every school-admin broadcast now goes through one path. |
| Callers `attendance/leave-service.ts:236`, `billing/submission-service.ts:87`, `schools/service.ts:164` | No change. |
| `prisma/schema/auth.prisma:79` | Add the relation `notificationMutes NotificationMute[]` after `loginEvents`. |
| `src/lib/auth/policy/notifications.ts:4` | The policy object is empty today. Add `"notification.preferences": { roles: ["SCHOOL_ADMIN"] }`, which covers primary and extra admins (the default still blocks during mustChangePassword). |
| `src/lib/auth/policy/users.ts:42` | Reuse `schoolAdmins.manage` (primarySchoolAdminOnly; enforced at `policy/index.ts:51`). |
| `src/lib/school-admins/queries.ts:11-22,26-40` | `ADMIN_SELECT` += `notificationMutes: { select: { category: true } }`. The DTO gains `mutedCategories`. |
| `src/lib/school-admins/schemas.ts:42-55` | `schoolAdminSchema` += `mutedCategories`. |
| `src/lib/school-admins/service.ts:15-19` | The new function does **not** use `manageableTarget`, because the primary admin may set its own list. It uses `getSchoolAdmin` (404 cross-tenant, `queries.ts:43-47`). |
| `src/lib/school-admins/contracts.ts:145-154` | Add one contract to the array. |
| `src/lib/auth/account-settings-service.ts:36-54` | Pattern to copy: `withTx` → `lockKey(userLockKey)` (`lock-keys.ts:49`) → write → `writeAudit` (`audit.ts:43`). |
| `src/lib/tx.ts:14` | Add the lock-order line `Preferensi notifikasi: AppLock user -> NotificationMute -> AuditLog.` |
| Frontend | `workspace.tsx:60`, `fields.tsx:42`, `security-panel.tsx:15,26-29`, `workspace-rules.ts:76-80`, `field-labels.ts:6`, `demo.ts:58-73` (§6). |

**Write-time vs read-time: write-time.**
1. Rows are already one per recipient (`notify.ts:34-45`). HRIS filters at read time only because its broadcast rows are shared (c971410).
2. One filter point covers the inbox list, the unread badge (`hub.tsx:35`, N1) and the push outbox (`pushStatus`, N3). HRIS 3b2b20c shipped the bug where the bell was filtered but pushes were not.
3. Inbox queries and indexes stay untouched (`notification.prisma:129-136`). The only cost is one PK lookup inside transactions that already write.
4. The category is stamped on the row (HRIS `notifKategori.ts:118-123`), so history keeps its meaning.

The trade-off is that changes are not retroactive, and the UI says so.

## 3. Data model

```prisma
// prisma/schema/notification.prisma (after model Notification)
/// Kategori siaran admin sekolah yang DIMATIKAN untuk satu akun (N2, keputusan pemilik 2026-10-03).
/// Tanpa baris = terima semua. Hanya menyaring notifySchoolAdmins saat menulis; notifikasi pribadi
/// dan SYSTEM selalu dikirim (CHECK chk_notification_mute_category).
model NotificationMute {
  userId    String
  category  NotificationCategory
  createdAt DateTime             @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Restrict)

  @@id([userId, category])
}
```

Folder: `prisma/migrations/20261003030000_notification_mute/migration.sql`

```sql
-- Kategori notifikasi per akun admin (keputusan pemilik 2026-10-03, N2). Aditif saja: satu tabel baru,
-- tidak menyentuh tabel lama. Satu baris = satu kategori siaran admin yang DIMATIKAN untuk satu akun;
-- akun tanpa baris menerima semua (perilaku lama, tanpa backfill). Kategori SYSTEM (perubahan pengaturan/
-- rekening sekolah, NISN dilepas) tidak pernah boleh dimatikan. Bila NotificationCategory kelak bertambah
-- nilai (di UJUNG), kolom `category` di tabel ini ikut di-MODIFY bersama Notification & Announcement.

-- CreateTable
CREATE TABLE `NotificationMute` (
    `userId` VARCHAR(191) NOT NULL,
    `category` ENUM('ACADEMIC', 'FINANCE', 'EVENT', 'CALENDAR', 'STUDENT_AFFAIRS', 'SYSTEM') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`, `category`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `NotificationMute` ADD CONSTRAINT `NotificationMute_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- SYSTEM selalu dikirim (dijaga juga oleh zod & rules.ts).
ALTER TABLE `NotificationMute` ADD CONSTRAINT `chk_notification_mute_category` CHECK (`category` <> 'SYSTEM');
```

The leftmost PK column serves as the FK index. Check the SQL with `prisma migrate diff --from-schema <HEAD schema> --to-schema prisma/schema --script` before committing; the CHECK is added by hand.

## 4. Pure rules: append to `src/lib/notifications/rules.ts`; tests in `rules.test.ts`, written first

```ts
/** Kategori siaran admin sekolah yang boleh dimatikan per akun (urutan = urutan tampilan). Tambahkan HANYA
 *  bila ada siaran notifySchoolAdmins berkategori itu; SYSTEM tidak pernah. */
export const ADMIN_MUTABLE_CATEGORIES = ["FINANCE", "STUDENT_AFFAIRS"] as const satisfies readonly NotificationCategory[];
export type AdminMutableCategory = (typeof ADMIN_MUTABLE_CATEGORIES)[number];
export function isAdminMutableCategory(c: NotificationCategory): c is AdminMutableCategory;
/** Buang duplikat & kategori yang tidak bisa dimatikan; urut sesuai ADMIN_MUTABLE_CATEGORIES. */
export function normalizeMutedCategories(input: readonly NotificationCategory[]): AdminMutableCategory[];
/** Perubahan set tersimpan -> set baru (removed boleh memuat kategori lama yang tak lagi bisa dimatikan). */
export function diffMutedCategories(stored: readonly NotificationCategory[], next: readonly AdminMutableCategory[]):
  { added: AdminMutableCategory[]; removed: NotificationCategory[] };
export interface BroadcastCandidate { readonly userId: string; readonly isPrimary: boolean; readonly muted: readonly NotificationCategory[] }
/** Kategori tak bisa dimatikan -> semua. Selain itu buang yang mematikan; bila hasilnya kosong padahal ada
 *  kandidat -> admin utama aktif saja, atau semua kandidat bila admin utama tidak ada/nonaktif. Urutan dijaga. */
export function selectBroadcastRecipients(candidates: readonly BroadcastCandidate[], category: NotificationCategory): string[];
```

node:test cases:
1. SYSTEM goes to every candidate, even one with a legacy `SYSTEM` entry.
2. For FINANCE, the account muting FINANCE is dropped and the rest are kept in order.
3. Muting STUDENT_AFFAIRS does not affect FINANCE.
4. When everyone mutes FINANCE, only the primary admin gets it.
5. When everyone mutes and no primary admin is among the candidates, all candidates get it.
6. No candidates gives `[]`.
7. `normalizeMutedCategories(["STUDENT_AFFAIRS","FINANCE","FINANCE","SYSTEM","ACADEMIC"])` returns `["FINANCE","STUDENT_AFFAIRS"]`.
8. For diff, an equal set gives both lists empty; stored `[SYSTEM]` → next `[]` gives removed `[SYSTEM]`.
9. `ADMIN_MUTABLE_CATEGORIES` never contains `SYSTEM`.

Frontend rules go in `src/lib/frontend/notification-prefs-rules.ts` (+ test). Labels come from `ENUM_LABELS.NotificationCategory` (`platform/enum-labels.ts:19-20`).

```ts
export const CATEGORY_HINTS: Readonly<Record<AdminMutableCategory, string>> = {
  FINANCE: "Bukti transfer SPP baru yang menunggu verifikasi.",
  STUDENT_AFFAIRS: "Pengajuan izin/sakit baru dari siswa.",
};
export function toggleMuted(muted: readonly AdminMutableCategory[], c: AdminMutableCategory, receive: boolean): AdminMutableCategory[]; // hasil ternormalisasi
export function prefsSummary(muted): string;      // [] -> "Semua kabar sekolah dikirim ke akun ini." ; [FINANCE] -> "Kabar Keuangan tidak dikirim ke akun ini." ; dua -> "Kabar Keuangan dan Kesiswaan tidak dikirim ke akun ini."
export function prefsSavedMessage(muted): string; // "Tersimpan. " + prefsSummary(muted)
```

Tests: one case for each of the three summary shapes; `toggleMuted` is idempotent and preserves order.

## 5. API

The self endpoints get new contracts in `src/lib/notifications/contracts.ts` (tag "Notifikasi", added to `notificationsContracts`). The schemas go in `notifications/schemas.ts`:

```ts
const mutableCategory = z.enum(ADMIN_MUTABLE_CATEGORIES);
export const updateNotificationPreferencesBody = z.strictObject({
  mutedCategories: z.array(mutableCategory).max(20).meta({ description: "Kategori kabar sekolah yang TIDAK dikirim ke akun ini. [] = terima semua. Ganti penuh (PUT)." }),
});
export const notificationPreferencesSchema = z.object({
  mutedCategories: z.array(mutableCategory),
  mutableCategories: z.array(mutableCategory).meta({ description: "Kategori yang bisa diatur, urutan tampilan." }),
}).meta({ id: "NotificationPreferences" });
```

| Method & path | Contract id | Action / roles | Body → Response | Errors |
|---|---|---|---|---|
| GET `/api/v1/me/notification-preferences` | `getMyNotificationPreferences` | `notification.preferences`: SCHOOL_ADMIN (primary + extra) | — → `NotificationPreferences` | 403 FORBIDDEN / PASSWORD_CHANGE_REQUIRED |
| PUT `/api/v1/me/notification-preferences` | `updateMyNotificationPreferences` | same | `updateNotificationPreferencesBody` → `NotificationPreferences` | 400 VALIDATION_FAILED (e.g. `SYSTEM`, missing field) |
| PUT `/api/v1/school/admins/{id}/notification-preferences?schoolId=` | `updateSchoolAdminNotificationPreferences` (in `school-admins/contracts.ts`; summary "Atur kabar sekolah yang dikirim ke satu akun admin"; description `${MANAGE_NOTE}` + "Admin utama boleh mengatur akunnya sendiri; akun lain sekolah/bukan admin -> 404.") | `schoolAdmins.manage`: primary admin, SUPER_ADMIN with `?schoolId=` | same body → `SchoolAdmin` (with `mutedCategories`) | `SCOPE_ERRORS` (`contracts.ts:23`), 404 NOT_FOUND, 400 VALIDATION_FAILED |

Routes:
- `src/app/api/v1/me/notification-preferences/route.ts` exports `GET`/`PUT` via `defineRoute`, like `me/email/route.ts`.
- `src/app/api/v1/school/admins/[id]/notification-preferences/route.ts` exports `PUT`, like `[id]/deactivate/route.ts`, using `schoolScopeOf(ctx, query.schoolId)`.

Service: new file `src/lib/notifications/preferences-service.ts`.
- `readNotificationMutes(userId, db = prisma)` runs `findMany({ where: { userId } })` and passes the result through `normalizeMutedCategories`. The table has no `schoolId`. The userId always comes from the principal or from a `getSchoolAdmin` that already passed the SchoolScope check.
- `replaceNotificationMutes(userId, schoolId, requested, ctx)` runs `withTx`:
  1. `lockKey(tx, userLockKey(userId))`. This serialises concurrent PUTs; without it, two delete+insert replacements would race into P2002.
  2. Read the stored categories.
  3. `next = normalizeMutedCategories(requested)` and `diffMutedCategories`. If both lists are empty, return without writing an audit.
  4. `deleteMany({ userId, category: { in: removed } })`, then `createMany(added → { userId, category, createdAt: ctx.now })`.
  5. `writeAudit(tx, { action: "user.notification_mutes", entityType: "User", entityId: userId, schoolId, before: { mutedCategories: stored }, after: { mutedCategories: next } }, ctx)`. The entry shows up in the school's Riwayat aktivitas.
- `getMyNotificationPreferences(ctx)` and `updateMyNotificationPreferences(input, ctx)` call `requirePrincipal`, use `principal.schoolId` for the audit, and return `{ mutedCategories, mutableCategories: [...ADMIN_MUTABLE_CATEGORIES] }`.
- `school-admins/service.ts` gets `updateSchoolAdminNotificationPreferences(scope, id, input, ctx)`: `await getSchoolAdmin(scope, id)`, then `replaceNotificationMutes(id, scope.schoolId, input.mutedCategories, ctx)`, then return `getSchoolAdmin(scope, id)`. Reading before the transaction is safe because role, school and primary status never change (`service.ts:13`).

Fan-out (`notify.ts`):

```ts
export async function notifySchoolAdmins(tx, schoolId, event, ctx) {
  const category = resolveCategory(event.type, event.category);
  const ids = await schoolAdminRecipients(tx, schoolId, category);
  return notifyRecipients(tx, ids.map((userId) => ({ userId, role: "SCHOOL_ADMIN" as const })), event, ctx);
}
async function schoolAdminRecipients(tx: Tx, schoolId: string, category: NotificationCategory): Promise<string[]> {
  const where = { schoolId, role: "SCHOOL_ADMIN" as const, isActive: true };
  if (!isAdminMutableCategory(category)) return (await tx.user.findMany({ where, select: { id: true } })).map((a) => a.id);
  const admins = await tx.user.findMany({ where, select: { id: true, primarySchoolId: true, notificationMutes: { where: { category }, select: { category: true } } } });
  return selectBroadcastRecipients(admins.map((a) => ({ userId: a.id, isPrimary: a.primarySchoolId !== null, muted: a.notificationMutes.map((m) => m.category) })), category);
}
```

The read is a plain READ COMMITTED read with no new locks. Notification and AuditLog are still written last.

## 6. UI changes

1. **Notifikasi page card (self).**
   - New file `src/components/hub/notification-prefs.tsx`, about 100 lines, exporting `NotificationPrefsCard` and `NotificationCategoriesField`.
   - Insert at `workspace.tsx:60`: `{module.key === "notifications" && me.user.role === "SCHOOL_ADMIN" && <NotificationPrefsCard />}`.
   - Reuse `SecurityCard` and `DEMO_MESSAGE`, exported from `security-panel.tsx:15,26-29`. `/me/notification-preferences` is outside module paths (`modules.ts:42-43`), so no generic tab appears.
   - States:
     - Loading: `<div class="skeleton">` with `aria-label="Memuat pilihan notifikasi"`.
     - Error: "Pilihan notifikasi belum berhasil dimuat." with **Coba lagi** next to it; never "semua dikirim" on failure (HRIS 3b2b20c).
     - View: title **"Kabar sekolah untuk akun ini"**, text `prefsSummary(muted)`, and an **"Atur"** button right beside it.
     - Edit: the `NotificationCategoriesField`, the footnote, an inline error, and buttons **Batal** / **Simpan pilihan**. Simpan is disabled until something changes; while saving it reads "Menyimpan…".
     - Success: `toast(prefsSavedMessage(next))` and the card collapses.
2. **`NotificationCategoriesField`** shows one checkbox per mutable category, where **checked = receive**. The label is "Keuangan"/"Kesiswaan" with `<small>` `CATEGORY_HINTS`. The fieldset legend is "Kabar yang dikirim". The single footnote line reads "Berlaku untuk notifikasi baru. Notifikasi pribadi dan kabar Sistem selalu dikirim; bila semua admin mematikan satu kategori, admin utama tetap menerimanya."
3. **Admin & guru row action.**
   - Add `if (name === "mutedCategories") return <NotificationCategoriesField value={value} onChange={onChange} />;` to `fields.tsx:42`, following the `schoolDaysMask` precedent.
   - The PUT path starts with `/school/admins/{id}`, so `RecordDialog` already lists it (`workspace.tsx:85,96`). It shows only to holders of `schoolAdmins.manage` (`workspace.tsx:25`).
   - `ActionDialog` pre-fills from the row (`action-dialog.tsx:64`; empty arrays survive `cleanBody`, `:39-49`).
   - Add `ACTION_LABELS.updateSchoolAdminNotificationPreferences = { label: "Atur notifikasi", hint: "Pilih kabar sekolah yang dikirim ke akun ini." }` (`workspace-rules.ts:76-80`).
   - Add `FIELD_LABELS.mutedCategories = "Kabar yang dimatikan"` and `mutableCategories = "Kabar yang bisa diatur"`. The guard in `field-labels.test.ts` requires them.
   - In `format.ts:34`, an empty array displays "—".
4. **Demo.** Add to `demo.ts` `sharedRows`, which today returns `[]` for `/school/admins` (:72):
   - `"/me/notification-preferences"` → `{ mutedCategories: [], mutableCategories: ["FINANCE","STUDENT_AFFAIRS"] }`.
   - `"/school/admins"` → 3 `demoSchoolAdmins`: the primary admin with `loginNpsn`; "Bu Rina (Wali kelas X IPA 1)" with `mutedCategories: ["FINANCE"]`; "Pak Dodi (Guru BK)" with `[]`.
   - Saving in demo shows `DEMO_MESSAGE` inline, as in the card and in `action-dialog.tsx:75`.
   - Run `pnpm frontend:sync` and `pnpm openapi:export`.

## 7. Tests

- **Unit**
  - `notifications/rules.test.ts` (§4).
  - `frontend/notification-prefs-rules.test.ts`.
  - `auth/policy/index.test.ts`: `notification.preferences` allows SCHOOL_ADMIN (primary and extra) and denies STUDENT, SPONSOR, SUPER_ADMIN, and any account with mustChangePassword.
  - `notifications/schemas.test.ts`: the body rejects `SYSTEM` and `{}` and accepts `[]`.
  - `frontend/demo.test.ts`: demo admins match the DTO keys, and exactly one is primary.
  - `frontend/format.test.ts`: `display([])` is "—".
- **Integration: `tests/integration/notifications/preferences.test.ts`** (new; seeds a school with a primary admin P and extras A and B, like `users/school-admins.test.ts:33-43`)
  1. GET with no rows returns `{ mutedCategories: [], mutableCategories: [FINANCE, STUDENT_AFFAIRS] }`.
  2. PUT `[FINANCE, FINANCE]` stores one row, writes the audit `user.notification_mutes` with before/after and the schoolId, and returns the new state. Repeating the same PUT adds no audit row.
  3. PUT `[SYSTEM]` returns 400 VALIDATION_FAILED. STUDENT, SPONSOR and SUPER_ADMIN get 403.
  4. Fan-out through `withTx(notifySchoolAdmins…)` as in `platform/tx-notify.test.ts:44-60`, with A muting FINANCE and B muting STUDENT_AFFAIRS:
     - `PAYMENT_SUBMITTED` reaches {P, B}.
     - `LEAVE_SUBMITTED` reaches {P, A}.
     - `SCHOOL_SETTINGS_CHANGED` reaches {P, A, B}.
  5. Personal notifications are untouched: `notifyUsers([A], INVOICE_ISSUED)` (FINANCE) still creates A's row.
  6. Fallback: if P, A and B all mute FINANCE, only P gets the row. If P is then deactivated, A and B get it.
  7. Not retroactive: rows created before the mute keep their unread count. After unmuting, the next event arrives.
- **Integration: extend `users/school-admins.test.ts`**
  1. The primary admin PUTs for an extra admin and gets 200 with `mutedCategories`. List and detail include it, and the audit records the primary admin as actor.
  2. The primary admin PUTs on its own id and gets 200, not PRIMARY_ADMIN_PROTECTED.
  3. An extra admin gets 403 PRIMARY_ADMIN_ONLY.
  4. Another school's admin id or a student id gets 404.
  5. A super admin without `schoolId` gets the scope error; with it, 200.
  6. Afterwards, the target's own GET `/me/...` reflects the change.
- **Integration: real routes.** Add one case to `attendance/leave/student.test.ts` (next to :77-95): an admin with STUDENT_AFFAIRS muted gets no `LEAVE_SUBMITTED`. The existing `students/nisn-release.test.ts` must stay green after the refactor.
- **E2E (`e2e/`)**: no change. Add a local-only browser test (`tests/browser/frontend.spec.ts`): toggling Keuangan sends `{ mutedCategories: ["FINANCE"] }` and shows the toast, and demo mode shows the demo message.

## 8. Docs to update

- `docs/PLAN.md`:
  - In the "Pengumuman & notifikasi" paragraph (:226-231), add one sentence: admin sekolah boleh mematikan kategori kabar sekolah (Keuangan, Kesiswaan) untuk akunnya, dan admin utama juga untuk akun admin tambahan (keputusan 2026-10-03). Only broadcasts to admins are filtered, at write time. Personal notifications and SYSTEM are always delivered. If every admin turns a category off, the primary admin still gets it.
  - In "Ditunda" (:259-263), keep "sub-peran admin" and add "filter notifikasi per kelas guru".
- `docs/backlog.md`: add a row "Notifikasi 'hanya kelas saya'" (do it once a teacher↔class link exists) and a row "Preferensi notifikasi super admin" (every SA broadcast is SYSTEM; do it once several SAs split duties). In the "Sub-peran" row (:24), note that N2 filters notifications only and does not separate access.
- `docs/FRONTEND.md`: Admin sekolah row (:17) += "notifikasi: atur kabar yang diterima". After the table, describe the card, the "Atur notifikasi" row action, checked = receive, and demo behavior.
- `docs/design/05-platform-crosscutting.md` §N: add **N12. Admin category mutes** (summary of §2–§5).

## 9. Edge cases & risks

- **Everyone mutes a category, so a work item goes silent.** This is the biggest risk. The primary-admin fallback handles it, and if no active primary exists, everyone gets it. The fallback is stated in the UI. HRIS lesson (3b2b20c): an unregistered item "menjadi DIAM bagi orang yang bertugas menanganinya".
- **Future categories.** N4 and B1 will add admin broadcasts. Adding a NotificationCategory value means appending it at the end and running `MODIFY` on `Notification.category`, `Announcement.category` and **`NotificationMute.category`**. It also means adding the value to `ADMIN_MUTABLE_CATEGORIES` and `CATEGORY_HINTS`. Doc comments in both places say so.
- **Concurrency.** The user AppLock serialises concurrent PUTs. A fan-out running during a PUT sees either the old or the new list, which is acceptable.
- **Stored values that are no longer mutable** are ignored, hidden by `normalize`, and removed on the next PUT. SYSTEM is blocked by zod, the rules and the DB CHECK.
- **Inactive admins** are excluded as before; their list persists. An extra admin with mustChangePassword cannot use `/me`, but the primary admin can still set it.
- **Other HRIS lessons:**
  - Personal notifications are never filtered, and unconfigured accounts behave as before: opt-out, no backfill (3b2b20c, `notifKategori.ts:131-140`).
  - Only checkboxes that actually filter something are shown, so super admins get no UI.
  - Preferences stay independent of permissions, unlike the scope logic in `notifScope.ts:35-70`, which was rewritten three times.
  - "Departemen sendiri" (53e4aba) corresponds to "kelas saya" here, which is future work.

## 10. Open questions (owner-level; defaults proposed)

1. **Fallback when every admin mutes a category.** *Default:* the primary admin still receives it.
2. **May extra admins change their own list, or only the primary admin?** *Default:* both may; last write wins, and the audit shows who changed it.
3. **SYSTEM always on** (settings and bank account changes, NISN released)? *Default:* yes, it cannot be muted.
4. **Attendance notifications (N4/B1).** *Default:* N4 appends a new category `ATTENDANCE` ("Kehadiran") and makes it mutable, rather than folding it into Kesiswaan.
