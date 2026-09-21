import type { ActionContext } from "@/lib/auth/principal";
import { computeLateness, decideCheckIn, distanceToSchool, rejectMessage, windowState, type CheckInDecision, type LocationFix } from "./check-in-rules";
import { decisionInputOf, loadCheckInContext, type CheckInContext } from "./check-in-context";
import { locationFixOf } from "./check-in-service";
import { logRejectionSafely } from "./rejection-log";
import type { PrecheckBody, PrecheckResultDto } from "./student-schemas";

/**
 * Precheck lokasi SEBELUM memotret selfie: keputusan murni yang SAMA dengan check-in, tanpa selfie dan
 * tanpa berkas. Keputusan klien PLAN: lokasi palsu (MOCK_LOCATION) DICATAT sebagai CheckInRejection untuk
 * admin (kuota 20/hari yang sama dengan check-in, deviceId dari sesi) — di alur aplikasi precheck mendahului
 * check-in, jadi tanpa catatan ini percobaan fake GPS tidak pernah terlihat admin. Penolakan lain tidak
 * dicatat (siswa jujur mengulang precheck sambil berjalan ke sekolah). `distanceM` hanya dikirim bila
 * keputusan mencapai langkah geofence (ACCEPT / OUTSIDE_GEOFENCE) agar precheck bukan orakel jarak gratis.
 */
type Verdict = Pick<PrecheckResultDto, "ok" | "reason" | "message">;

function verdictOf(decision: CheckInDecision, wouldBeLate: boolean): Verdict {
  switch (decision.kind) {
    case "REPLAY":
      return { ok: false, reason: "ALREADY_CHECKED_IN", message: "Anda sudah absen hari ini." };
    case "CONFLICT":
      return { ok: false, reason: "ATTENDANCE_ALREADY_RECORDED", message: "Absensi hari ini sudah dicatat sekolah." };
    case "REJECT":
      return { ok: false, reason: decision.rejection.code, message: rejectMessage(decision.rejection) };
    case "ACCEPT":
      return {
        ok: true,
        reason: null,
        message: wouldBeLate ? "Lokasi valid. Check-in sekarang akan tercatat Terlambat." : "Lokasi valid. Silakan ambil selfie untuk absen.",
      };
  }
}

/** Keputusan yang sudah melewati langkah geofence (jarak relevan bagi siswa). */
function reachedGeofence(decision: CheckInDecision): boolean {
  return decision.kind === "ACCEPT" || (decision.kind === "REJECT" && decision.rejection.code === "OUTSIDE_GEOFENCE");
}

async function logMockAttempt(context: CheckInContext, fix: LocationFix, now: Date): Promise<void> {
  const { student, principal } = context;
  const distanceM = distanceToSchool(fix, context.school.geofence);
  await logRejectionSafely(
    { schoolId: student.schoolId, studentId: student.id, date: context.local.ymd, reason: "MOCK_LOCATION", fix, distanceM, deviceId: principal.deviceId },
    now,
  );
}

export async function precheckAttendance(body: PrecheckBody, ctx: ActionContext): Promise<PrecheckResultDto> {
  const context = await loadCheckInContext(ctx);
  const fix = locationFixOf(body);
  const { schedule, geofence } = context.school;
  const minute = context.local.minuteOfDay;
  const wouldBeLate = computeLateness(minute, schedule).status === "TERLAMBAT";
  const decision = decideCheckIn(decisionInputOf(context, fix));
  if (decision.kind === "REJECT" && decision.rejection.code === "MOCK_LOCATION") await logMockAttempt(context, fix, ctx.now);
  return {
    ...verdictOf(decision, wouldBeLate),
    distanceM: reachedGeofence(decision) ? distanceToSchool(fix, geofence) : null,
    radiusM: geofence.radiusM,
    window: windowState(minute, schedule),
    wouldBeLate,
  };
}
