/**
 * Semaphore FIFO sederhana untuk membatasi pipeline gambar yang berjalan bersamaan
 * (proses PM2 tunggal — menjaga CPU/memori saat banyak unggahan pagi hari).
 */
export interface Semaphore {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
}

export function createSemaphore(limit: number): Semaphore {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Batas semaphore harus bilangan bulat ≥ 1");
  const waiters: Array<() => void> = [];
  let active = 0;

  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    // Slot diserahkan langsung oleh release() sehingga `active` tidak turun-naik (urutan FIFO terjaga).
    await new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active(): number {
      return active;
    },
    get pending(): number {
      return waiters.length;
    },
  };
}
