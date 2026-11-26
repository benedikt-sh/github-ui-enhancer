export type SerialQueue = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs tasks one after another. A failing task rejects its own promise but not later tasks. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
}
