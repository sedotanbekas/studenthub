import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Db, type Tx } from "@/lib/db";
import { attendanceTestModeLockKey } from "@/lib/lock-keys";
import { SETTINGS_ID } from "@/lib/sponsors/settings-service";
import { lockKey, withTx } from "@/lib/tx";
import type { AttendanceTestModeDto } from "./admin-schemas";

/**
 * Mode uji absensi (SEMENTARA, keputusan pemilik 2026-10-02) agar tester bisa absen dari mana saja dan kapan
 * saja. Satu sakelar untuk SEMUA sekolah di PlatformSetting.attendanceTestModeSince (NULL = terkunci), hanya
 * super admin, diaudit. Selama aktif decideCheckIn melewati hari sekolah, jendela absen, dan geofence; (0,0),
 * lokasi palsu, data basi, akurasi GPS, selfie, dan sesi HP tetap wajib, dan check-in yang lolos berkat mode ini
 * diberi flag TEST_MODE (MEDIUM: tampil di antrean anomali admin sekolah). Status dibaca sebelum transaksi
 * check-in, jadi check-in yang sedang berjalan saat sakelar diubah masih memakai status lama (satu permintaan).
 * Saat fitur tidak diperlukan lagi: matikan, lalu hapus berkas ini beserta pemakainya.
 */
async function testModeSince(db: Db | Tx): Promise<Date | null> {
  const row = await db.platformSetting.findUnique({ where: { id: SETTINGS_ID }, select: { attendanceTestModeSince: true } });
  return row?.attendanceTestModeSince ?? null;
}

const toDto = (since: Date | null): AttendanceTestModeDto => ({ enabled: since !== null, since: since?.toISOString() ?? null });

export async function isAttendanceTestMode(db: Db | Tx = prisma): Promise<boolean> {
  return (await testModeSince(db)) !== null;
}

export async function getAttendanceTestMode(): Promise<AttendanceTestModeDto> {
  return toDto(await testModeSince(prisma));
}

/** Nyalakan/matikan untuk semua sekolah. Idempoten: status sama -> tanpa tulis & tanpa audit. */
export async function setAttendanceTestMode(enabled: boolean, ctx: ActionContext): Promise<AttendanceTestModeDto> {
  return withTx(async (tx) => {
    await lockKey(tx, attendanceTestModeLockKey());
    const before = await testModeSince(tx);
    if ((before !== null) === enabled) return toDto(before);
    const since = enabled ? ctx.now : null;
    await tx.platformSetting.update({ where: { id: SETTINGS_ID }, data: { attendanceTestModeSince: since, updatedAt: ctx.now } });
    await writeAudit(
      tx,
      {
        action: enabled ? "platform.attendance_test_mode.enable" : "platform.attendance_test_mode.disable",
        entityType: "PlatformSetting",
        entityId: String(SETTINGS_ID),
        before: toDto(before),
        after: toDto(since),
      },
      ctx,
    );
    return toDto(since);
  });
}
