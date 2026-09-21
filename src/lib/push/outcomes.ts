import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sanitizeErrorCode, type PushOutcome } from "./rules";

/**
 * Tulis hasil push ke Notification. SETIAP update dijaga `pushStatus = PENDING AND pushNextAttemptAt =
 * leaseUntil` (klaim milik dispatcher ini): klaim yang sudah kedaluwarsa & diambil dispatcher lain tidak
 * pernah ditimpa, dan notifikasi yang dihapus (pengumuman ditarik) cukup menghasilkan 0 baris.
 */
export interface OutcomeCounts {
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface NotificationOutcome {
  readonly id: string;
  readonly outcome: PushOutcome;
}

function outcomeData(outcome: PushOutcome, now: Date): Prisma.NotificationUpdateManyMutationInput {
  switch (outcome.status) {
    case "SENT":
      return { pushStatus: "SENT", pushedAt: now, pushAttempts: { increment: 1 }, pushError: null };
    case "PENDING":
      return { pushNextAttemptAt: outcome.nextAttemptAt, pushAttempts: { increment: 1 }, pushError: sanitizeErrorCode(outcome.error) };
    case "FAILED":
      return { pushStatus: "FAILED", pushAttempts: { increment: 1 }, pushError: sanitizeErrorCode(outcome.error) };
    case "SKIPPED":
      return { pushStatus: "SKIPPED", pushError: sanitizeErrorCode(outcome.error) };
  }
}

function outcomeKey(outcome: PushOutcome): string {
  if (outcome.status === "SENT") return "SENT";
  if (outcome.status === "PENDING") return `PENDING|${outcome.nextAttemptAt.toISOString()}|${outcome.error}`;
  return `${outcome.status}|${outcome.error}`;
}

const COUNT_FIELD: Readonly<Record<PushOutcome["status"], keyof OutcomeCounts>> = {
  SENT: "sent",
  PENDING: "retried",
  FAILED: "failed",
  SKIPPED: "skipped",
};

function groupOutcomes(items: readonly NotificationOutcome[]): Array<{ outcome: PushOutcome; ids: string[] }> {
  const groups = new Map<string, { outcome: PushOutcome; ids: string[] }>();
  for (const item of items) {
    const key = outcomeKey(item.outcome);
    const group = groups.get(key);
    groups.set(key, { outcome: item.outcome, ids: [...(group?.ids ?? []), item.id] });
  }
  return [...groups.values()];
}

/** Satu updateMany per kelompok hasil yang sama; hitungan = baris yang benar-benar berubah. */
export async function applyOutcomes(items: readonly NotificationOutcome[], leaseUntil: Date, now: Date): Promise<OutcomeCounts> {
  const counts: Record<keyof OutcomeCounts, number> = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  for (const group of groupOutcomes(items)) {
    const { count } = await prisma.notification.updateMany({
      where: { id: { in: group.ids }, pushStatus: "PENDING", pushNextAttemptAt: leaseUntil },
      data: outcomeData(group.outcome, now),
    });
    counts[COUNT_FIELD[group.outcome.status]] += count;
  }
  return counts;
}
