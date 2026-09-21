import type { ActionContext } from "@/lib/auth/principal";
import { computeLateness, decideCheckIn, distanceToSchool, rejectMessage, windowState, type CheckInDecision } from "./check-in-rules";
import { decisionInputOf, loadCheckInContext } from "./check-in-context";
import { locationFixOf } from "./check-in-service";
import type { PrecheckBody, PrecheckResultDto } from "./student-schemas";

/**
 * Precheck lokasi SEBELUM memotret selfie: keputusan murni yang SAMA dengan check-in, tanpa selfie,
 * tanpa menulis apa pun (tidak ada CheckInRejection, tidak ada berkas).
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

export async function precheckAttendance(body: PrecheckBody, ctx: ActionContext): Promise<PrecheckResultDto> {
  const context = await loadCheckInContext(ctx);
  const fix = locationFixOf(body);
  const { schedule, geofence } = context.school;
  const minute = context.local.minuteOfDay;
  const wouldBeLate = computeLateness(minute, schedule).status === "TERLAMBAT";
  return {
    ...verdictOf(decideCheckIn(decisionInputOf(context, fix)), wouldBeLate),
    distanceM: distanceToSchool(fix, geofence),
    radiusM: geofence.radiusM,
    window: windowState(minute, schedule),
    wouldBeLate,
  };
}
