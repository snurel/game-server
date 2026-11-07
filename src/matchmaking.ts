export interface QueueEntry<T> {
  item: T;
  enqueuedAt: number;
}

/**
 * First-come matchmaking per mode. When `groupSize` players wait in the same
 * mode, enqueue() returns them as a group and removes them from the queue.
 */
export class MatchQueue<T, TKey = number> {
  private readonly queues = new Map<string, QueueEntry<T>[]>();

  constructor(
    private readonly keyOf: (item: T) => TKey,
    private readonly groupSize = 2,
  ) {
    if (groupSize < 2) throw new RangeError('MatchQueue: groupSize must be >= 2');
  }

  enqueue(mode: string, item: T, now = Date.now()): T[] | null {
    this.remove(this.keyOf(item));
    const queue = this.queueFor(mode);
    queue.push({ item, enqueuedAt: now });
    if (queue.length < this.groupSize) return null;
    return queue.splice(0, this.groupSize).map((entry) => entry.item);
  }

  /** Removes the item from every mode. Returns true if it was queued. */
  remove(key: TKey): boolean {
    for (const queue of this.queues.values()) {
      const index = queue.findIndex((entry) => this.keyOf(entry.item) === key);
      if (index !== -1) {
        queue.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  has(key: TKey): boolean {
    for (const queue of this.queues.values()) {
      if (queue.some((entry) => this.keyOf(entry.item) === key)) return true;
    }
    return false;
  }

  /** Removes and returns entries that waited at least `ms`, e.g. to pair them with a bot. */
  takeWaitingLongerThan(mode: string, ms: number, now = Date.now()): T[] {
    const queue = this.queueFor(mode);
    const stale = queue.filter((entry) => now - entry.enqueuedAt >= ms);
    this.queues.set(mode, queue.filter((entry) => now - entry.enqueuedAt < ms));
    return stale.map((entry) => entry.item);
  }

  length(mode: string): number {
    return this.queues.get(mode)?.length ?? 0;
  }

  private queueFor(mode: string): QueueEntry<T>[] {
    let queue = this.queues.get(mode);
    if (!queue) {
      queue = [];
      this.queues.set(mode, queue);
    }
    return queue;
  }
}
