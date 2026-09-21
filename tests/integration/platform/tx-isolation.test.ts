import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { lockKey, withTx } from "@/lib/tx";
import { disconnect, prisma, uniq, type Tx } from "../helpers/db";

/**
 * Regresi isolasi & retry withTx: default READ COMMITTED (baca ulang setelah lockKey melihat commit
 * transaksi lain) dan deadlock/lock-wait dari query mentah (P2010 1213/1205) diulang otomatis.
 */
after(disconnect);

type Gate = { readonly wait: Promise<void>; readonly open: () => void };

function gate(): Gate {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const countRows = (tx: Tx, prefix: string) => tx.appLock.count({ where: { key: { startsWith: `${prefix}:row` } } });

/** Baca, commit baris dari koneksi lain (autocommit), lalu baca ulang di transaksi yang sama. */
async function readTwiceAroundForeignCommit(prefix: string, isolationLevel?: Prisma.TransactionIsolationLevel): Promise<number[]> {
  return withTx(
    async (tx) => {
      const before = await countRows(tx, prefix);
      await prisma.appLock.create({ data: { key: `${prefix}:row:1` } });
      const afterCommit = await countRows(tx, prefix);
      return [before, afterCommit];
    },
    isolationLevel ? { isolationLevel } : {},
  );
}

test("withTx default READ COMMITTED: baca ulang melihat baris yang di-commit transaksi lain", async () => {
  assert.deepEqual(await readTwiceAroundForeignCommit(`iso:${uniq()}`), [0, 1]);
});

test("withTx tetap menghormati isolationLevel eksplisit (REPEATABLE READ = snapshot tetap)", async () => {
  const seen = await readTwiceAroundForeignCommit(`iso:${uniq()}`, Prisma.TransactionIsolationLevel.RepeatableRead);
  assert.deepEqual(seen, [0, 0]);
});

test("baca setelah lockKey melihat baris yang di-commit pemegang kunci sesudah baca pertama", async () => {
  const prefix = `iso:${uniq()}`;
  const key = `${prefix}:lock`;
  const holderLocked = gate();
  const waiterRead = gate();
  const holder = withTx(async (tx) => {
    await lockKey(tx, key);
    holderLocked.open();
    await waiterRead.wait;
    await tx.appLock.create({ data: { key: `${prefix}:row:1` } });
  });
  const waiter = withTx(async (tx) => {
    await holderLocked.wait;
    const before = await countRows(tx, prefix);
    waiterRead.open();
    await lockKey(tx, key);
    return [before, await countRows(tx, prefix)];
  });
  await holder;
  assert.deepEqual(await waiter, [0, 1]);
});

test("deadlock dari query mentah (P2010 errno 1213) diulang dan kedua transaksi berhasil", async () => {
  const prefix = `dl:${uniq()}`;
  const [first, second] = [`${prefix}:a`, `${prefix}:b`];
  await prisma.appLock.createMany({ data: [{ key: first }, { key: second }] });
  const firstLocked = gate();
  const secondLocked = gate();
  let attempts = 0;
  const crossLock = (own: string, other: string, mine: Gate, theirs: Gate) =>
    withTx(async (tx) => {
      attempts += 1;
      await lockKey(tx, own);
      mine.open();
      await theirs.wait;
      await pause(150);
      await lockKey(tx, other);
    });
  const results = await Promise.allSettled([
    crossLock(first, second, firstLocked, secondLocked),
    crossLock(second, first, secondLocked, firstLocked),
  ]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"]);
  assert.ok(attempts >= 3, `korban deadlock harus diulang (percobaan: ${attempts})`);
});

test("lock wait timeout dari query mentah (P2010 errno 1205) diulang sampai kunci lepas", async () => {
  const key = `lw:${uniq()}`;
  const holderLocked = gate();
  const waiterFailedOnce = gate();
  let attempts = 0;
  const holder = withTx(async (tx) => {
    await lockKey(tx, key);
    holderLocked.open();
    await waiterFailedOnce.wait;
  });
  const waiter = withTx(async (tx) => {
    attempts += 1;
    if (attempts > 1) waiterFailedOnce.open();
    await holderLocked.wait;
    await tx.$executeRawUnsafe("SET SESSION innodb_lock_wait_timeout = 1");
    try {
      await lockKey(tx, key);
    } finally {
      await tx.$executeRawUnsafe("SET SESSION innodb_lock_wait_timeout = DEFAULT");
    }
    return attempts;
  });
  const settled = waiter.finally(() => waiterFailedOnce.open());
  const [waiterResult] = await Promise.allSettled([settled, holder]);
  assert.deepEqual(waiterResult, { status: "fulfilled", value: 2 });
});
