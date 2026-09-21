import { randomUUID } from "node:crypto";
import type { JobContext } from "@/lib/auth/principal";
import { PUSH_DISPATCH_BUDGET_MS } from "./constants";
import { dispatchPendingPushes, mergeDispatchSummary, type DispatchSummary } from "./dispatch";
import { createSingleFlight, type SingleFlight } from "./single-flight";

/**
 * Titik masuk dispatcher untuk proses ini: kick setelah respons (notify -> ctx.defer) dan job tick
 * `push-dispatch` berbagi SATU mutex in-process. Kick saat putaran berjalan = satu putaran lagi sesudahnya.
 * Mutex disimpan di globalThis agar tetap satu per proses walau modul dimuat ulang antar-route bundle.
 */
type PushFlight = SingleFlight<JobContext, DispatchSummary>;
type RunnerGlobal = { __studenthubPushFlight?: PushFlight; __studenthubPushKickScope?: JobContext["scope"] };
const store = globalThis as unknown as RunnerGlobal;

function flight(): PushFlight {
  store.__studenthubPushFlight ??= createSingleFlight<JobContext, DispatchSummary>((ctx) => dispatchPendingPushes(ctx), mergeDispatchSummary);
  return store.__studenthubPushFlight;
}

/** `makeContext` dievaluasi saat putaran dimulai (now segar untuk putaran ulang). */
export function runPushDispatch(makeContext: () => JobContext): Promise<DispatchSummary> {
  return flight().run(makeContext);
}

export function isPushDispatchRunning(): boolean {
  return flight().isRunning();
}

/**
 * HANYA test integrasi: batasi cakupan putaran kick (DB uji dipakai bersama proses test lain; kick tanpa
 * cakupan akan ikut mengirim/menandai outbox milik test lain). Di luar NODE_ENV=test ditolak.
 */
export function setKickScopeForTests(scope: JobContext["scope"] | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setKickScopeForTests hanya untuk test");
  store.__studenthubPushKickScope = scope;
}

/** Konteks kick: tanpa cakupan (seluruh outbox), anggaran PUSH_DISPATCH_BUDGET_MS. */
export function kickContext(): JobContext {
  const now = new Date();
  const scope = store.__studenthubPushKickScope;
  return { now, requestId: `push-kick-${randomUUID()}`, deadline: now.getTime() + PUSH_DISPATCH_BUDGET_MS, ...(scope ? { scope } : {}) };
}
