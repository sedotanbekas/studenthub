import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobRunStatus } from "@prisma/client";
import type { JobContext } from "@/lib/auth/principal";
import { executeKeyedJob, type JobRunClaim, type JobRunFinish, type JobRunKey, type JobRunSnapshot, type JobRunStore } from "./keyed";
import type { JobResult } from "./types";

const NOW = new Date("2026-09-21T19:30:00Z");
const FINISHED_AT = new Date("2026-09-21T19:30:05Z");
const KEY: JobRunKey = { job: "files-orphan-cleanup", scopeKey: "global", runKey: "2026-09-21T19" };
const CTX: JobContext = { now: NOW, requestId: "req-test-keyed", deadline: NOW.getTime() + 50_000 };
const clock = (): Date => FINISHED_AT;
const minutesAgo = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

type Row = JobRunSnapshot & { readonly finishedAt: Date | null; readonly result: JobResult | null; readonly error: string | null };

/** Store palsu di memori dengan semantik unik + compare-and-set yang sama dengan MariaDB. */
class MemoryStore implements JobRunStore {
  rows = new Map<string, Row>();
  failCreateWith: unknown = null;
  loseReclaim = false;
  loseFinish = false;
  private seq = 0;

  private k(key: JobRunKey): string {
    return `${key.job}|${key.scopeKey}|${key.runKey}`;
  }

  seed(key: JobRunKey, status: JobRunStatus, startedAt: Date, attempts: number): void {
    this.rows.set(this.k(key), { id: `seed-${++this.seq}`, status, startedAt, attempts, finishedAt: null, result: null, error: null });
  }

  row(key: JobRunKey = KEY): Row | undefined {
    return this.rows.get(this.k(key));
  }

  async create(key: JobRunKey, startedAt: Date): Promise<JobRunClaim> {
    if (this.failCreateWith) throw this.failCreateWith;
    if (this.rows.has(this.k(key))) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    const id = `run-${++this.seq}`;
    this.rows.set(this.k(key), { id, status: "RUNNING", startedAt, attempts: 1, finishedAt: null, result: null, error: null });
    return { id, startedAt };
  }

  async findByKey(key: JobRunKey): Promise<JobRunSnapshot | null> {
    const row = this.rows.get(this.k(key));
    return row ? { id: row.id, status: row.status, startedAt: row.startedAt, attempts: row.attempts } : null;
  }

  async reclaim(existing: JobRunSnapshot, mode: "RETRY" | "TAKEOVER", startedAt: Date): Promise<JobRunClaim | null> {
    const entry = [...this.rows.entries()].find(([, row]) => row.id === existing.id);
    if (!entry || this.loseReclaim) return null;
    const [key, row] = entry;
    const matches = mode === "RETRY" ? row.status === "FAILED" : row.status === "RUNNING" && row.startedAt.getTime() === existing.startedAt.getTime();
    if (!matches) return null;
    this.rows.set(key, { ...row, status: "RUNNING", attempts: row.attempts + 1, startedAt, finishedAt: null });
    return { id: row.id, startedAt };
  }

  async finish(claim: JobRunClaim, patch: JobRunFinish): Promise<boolean> {
    const entry = [...this.rows.entries()].find(([, row]) => row.id === claim.id);
    if (!entry || this.loseFinish) return false;
    const [key, row] = entry;
    if (row.status !== "RUNNING" || row.startedAt.getTime() !== claim.startedAt.getTime()) return false;
    const next: Row =
      patch.status === "SUCCEEDED"
        ? { ...row, status: "SUCCEEDED", finishedAt: patch.finishedAt, result: patch.result, error: null }
        : { ...row, status: "FAILED", finishedAt: patch.finishedAt, error: patch.error };
    this.rows.set(key, next);
    return true;
  }
}

const counter = (): { calls: number; fn: () => Promise<JobResult> } => {
  const state = { calls: 0, fn: async (): Promise<JobResult> => ({}) };
  state.fn = async () => {
    state.calls += 1;
    return { deleted: 2 };
  };
  return state;
};

test("run pertama: membuat JobRun RUNNING lalu SUCCEEDED dengan result & finishedAt", async () => {
  const store = new MemoryStore();
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "ran");
  assert.equal(job.calls, 1);
  const row = store.row();
  assert.equal(row?.status, "SUCCEEDED");
  assert.equal(row?.attempts, 1);
  assert.deepEqual(row?.startedAt, NOW);
  assert.deepEqual(row?.finishedAt, FINISHED_AT);
  assert.deepEqual(row?.result, { deleted: 2 });
});

test("result disimpan sebagai JSON murni (Date → ISO)", async () => {
  const store = new MemoryStore();
  await executeKeyedJob(store, KEY, async () => ({ at: new Date("2026-09-21T00:00:00Z") }), CTX, clock);
  assert.deepEqual(store.row()?.result, { at: "2026-09-21T00:00:00.000Z" });
});

test("kunci yang sudah SUCCEEDED dilewati tanpa menjalankan fn", async () => {
  const store = new MemoryStore();
  store.seed(KEY, "SUCCEEDED", minutesAgo(30), 1);
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "skipped");
  assert.equal(job.calls, 0);
});

test("fn melempar → FAILED dengan pesan error maksimal 2000 karakter", async () => {
  const store = new MemoryStore();
  const outcome = await executeKeyedJob(store, KEY, async () => { throw new Error("x".repeat(3000)); }, CTX, clock);
  assert.equal(outcome, "failed");
  const row = store.row();
  assert.equal(row?.status, "FAILED");
  assert.equal(row?.error?.length, 2000);
  assert.deepEqual(row?.finishedAt, FINISHED_AT);
});

test("FAILED dengan attempts 2 dicoba ulang: attempts 3, startedAt baru, lalu SUCCEEDED", async () => {
  const store = new MemoryStore();
  store.seed(KEY, "FAILED", minutesAgo(1), 2);
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "ran");
  assert.equal(job.calls, 1);
  assert.equal(store.row()?.attempts, 3);
  assert.equal(store.row()?.status, "SUCCEEDED");
  assert.deepEqual(store.row()?.startedAt, NOW);
  assert.equal(store.row()?.error, null);
});

test("FAILED dengan attempts 5 tetap FAILED (dilewati)", async () => {
  const store = new MemoryStore();
  store.seed(KEY, "FAILED", minutesAgo(1), 5);
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "skipped");
  assert.equal(job.calls, 0);
  assert.equal(store.row()?.status, "FAILED");
});

test("RUNNING segar dilewati; RUNNING basi (16 menit) diambil alih", async () => {
  const fresh = new MemoryStore();
  fresh.seed(KEY, "RUNNING", minutesAgo(5), 1);
  assert.equal(await executeKeyedJob(fresh, KEY, counter().fn, CTX, clock), "skipped");

  const stale = new MemoryStore();
  stale.seed(KEY, "RUNNING", minutesAgo(16), 1);
  const job = counter();
  assert.equal(await executeKeyedJob(stale, KEY, job.fn, CTX, clock), "ran");
  assert.equal(job.calls, 1);
  assert.equal(stale.row()?.attempts, 2);
  assert.equal(stale.row()?.status, "SUCCEEDED");
});

test("compare-and-set kalah (proses lain lebih dulu) → skipped tanpa menjalankan fn", async () => {
  const store = new MemoryStore();
  store.seed(KEY, "FAILED", minutesAgo(1), 1);
  store.loseReclaim = true;
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "skipped");
  assert.equal(job.calls, 0);
});

test("dua run bersamaan untuk kunci yang sama: tepat satu yang berjalan", async () => {
  const store = new MemoryStore();
  const job = counter();
  const outcomes = await Promise.all([
    executeKeyedJob(store, KEY, job.fn, CTX, clock),
    executeKeyedJob(store, KEY, job.fn, CTX, clock),
  ]);
  assert.deepEqual([...outcomes].sort(), ["ran", "skipped"]);
  assert.equal(job.calls, 1);
});

test("error DB selain P2002 saat klaim → failed tanpa menjalankan fn", async () => {
  const store = new MemoryStore();
  store.failCreateWith = Object.assign(new Error("koneksi putus"), { code: "P1001" });
  const job = counter();
  assert.equal(await executeKeyedJob(store, KEY, job.fn, CTX, clock), "failed");
  assert.equal(job.calls, 0);
});

test("baris hilang di antara P2002 dan pembacaan → skipped", async () => {
  const store = new MemoryStore();
  store.failCreateWith = Object.assign(new Error("dup"), { code: "P2002" });
  assert.equal(await executeKeyedJob(store, KEY, counter().fn, CTX, clock), "skipped");
});

test("kepemilikan hilang saat menandai selesai (diambil alih) → tetap 'ran' karena kerja sudah terjadi", async () => {
  const store = new MemoryStore();
  store.loseFinish = true;
  assert.equal(await executeKeyedJob(store, KEY, counter().fn, CTX, clock), "ran");
  assert.equal(store.row()?.status, "RUNNING");
});

test("gagal menulis status akhir setelah fn sukses → failed (baris akan diambil alih setelah basi)", async () => {
  const store = new MemoryStore();
  store.finish = async () => { throw new Error("DB mati"); };
  assert.equal(await executeKeyedJob(store, KEY, counter().fn, CTX, clock), "failed");
});

test("fn gagal dan pencatatan FAILED juga gagal → tetap failed tanpa melempar", async () => {
  const store = new MemoryStore();
  store.finish = async () => { throw new Error("DB mati"); };
  const outcome = await executeKeyedJob(store, KEY, async () => { throw new Error("gagal"); }, CTX, clock);
  assert.equal(outcome, "failed");
});
