/**
 * Mutex in-process "satu putaran sekaligus" dengan satu putaran ulang (desain 05 P3): panggilan saat
 * putaran berjalan tidak memulai putaran paralel, melainkan meminta SATU putaran lagi sesudahnya (dengan
 * konteks terbaru) dan menerima promise yang sama. Cukup karena aplikasi berjalan sebagai satu proses PM2.
 */
export interface SingleFlight<C, T> {
  run(makeContext: () => C): Promise<T>;
  isRunning(): boolean;
}

export function createSingleFlight<C, T>(pass: (context: C) => Promise<T>, merge: (total: T, next: T) => T): SingleFlight<C, T> {
  let current: Promise<T> | null = null;
  let pending: (() => C) | null = null;

  const takePending = (): (() => C) | null => {
    const next = pending;
    pending = null;
    return next;
  };

  async function drain(first: () => C): Promise<T> {
    // Beri kesempatan `current` terpasang dulu: bila makeContext/pass melempar sinkron, finally di bawah
    // tidak boleh berjalan sebelum run() menyimpan promise ini.
    await Promise.resolve();
    try {
      let total: T = await pass(first());
      for (let next = takePending(); next; next = takePending()) total = merge(total, await pass(next()));
      return total;
    } finally {
      // Dijalankan sinkron tepat setelah cek antrean terakhir: tidak ada celah permintaan yang hilang.
      current = null;
      pending = null;
    }
  }

  return {
    run(makeContext) {
      if (current) {
        pending = makeContext;
        return current;
      }
      const started = drain(makeContext);
      current = started;
      return started;
    },
    isRunning: () => current !== null,
  };
}
