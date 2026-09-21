import type { StudentStatusValue } from "./constants";

/**
 * Tabel transisi status siswa TUNGGAL. Pasangan yang tidak tercantum -> 409 INVALID_STATUS_TRANSITION.
 * `nisn`: CLAIM = klaim activeNisn (lepas pemegang LULUS di sekolah lain), KEEP = tidak berubah,
 * RELEASE = activeNisn NULL. `userActive` menjaga User.isActive selaras dengan status.
 */
export interface TransitionEffects {
  readonly userActive: boolean;
  readonly nisn: "CLAIM" | "KEEP" | "RELEASE";
  readonly revokeSessions: boolean;
  readonly requireComplete: boolean;
  readonly reasonRequired: boolean;
  readonly voidFutureInvoices: boolean;
}

const TO_ACTIVE: TransitionEffects = Object.freeze({
  userActive: true,
  nisn: "CLAIM",
  revokeSessions: false,
  requireComplete: true,
  reasonRequired: false,
  voidFutureInvoices: false,
});

const TO_INACTIVE: TransitionEffects = Object.freeze({
  userActive: false,
  nisn: "KEEP",
  revokeSessions: true,
  requireComplete: false,
  reasonRequired: true,
  voidFutureInvoices: false,
});

const TO_GRADUATED: TransitionEffects = Object.freeze({
  userActive: true,
  nisn: "KEEP",
  revokeSessions: false,
  requireComplete: false,
  reasonRequired: true,
  voidFutureInvoices: false,
});

const TO_MOVED: TransitionEffects = Object.freeze({
  userActive: false,
  nisn: "RELEASE",
  revokeSessions: true,
  requireComplete: false,
  reasonRequired: true,
  voidFutureInvoices: true,
});

type TransitionTable = Readonly<Record<StudentStatusValue, Readonly<Partial<Record<StudentStatusValue, TransitionEffects>>>>>;

export const STUDENT_TRANSITIONS: TransitionTable = Object.freeze({
  DRAFT: { ACTIVE: TO_ACTIVE },
  ACTIVE: { INACTIVE: TO_INACTIVE, GRADUATED: TO_GRADUATED, MOVED: TO_MOVED },
  INACTIVE: { ACTIVE: TO_ACTIVE, GRADUATED: TO_GRADUATED, MOVED: TO_MOVED },
  GRADUATED: { ACTIVE: TO_ACTIVE, MOVED: TO_MOVED },
  MOVED: { ACTIVE: TO_ACTIVE },
});

/** Efek transisi, atau null bila transisi tidak diizinkan. */
export function planTransition(from: StudentStatusValue, to: StudentStatusValue): TransitionEffects | null {
  return STUDENT_TRANSITIONS[from][to] ?? null;
}

/** Status yang boleh login (LULUS = baca-saja). */
export function isLoginStatus(status: StudentStatusValue): boolean {
  return status === "ACTIVE" || status === "GRADUATED";
}
