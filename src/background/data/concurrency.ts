/** Like `Promise.all(items.map(task))`, but with at most `limit` tasks running at a time. */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // All workers pull from the same iterator, so every item is taken exactly once.
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      results[index] = await task(item);
    }
  };
  const workers = Math.min(items.length, Math.max(1, Math.floor(limit)));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
