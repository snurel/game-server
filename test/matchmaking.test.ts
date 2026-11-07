import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchQueue, TurnTimer } from '../src';

type P = { id: number };

describe('MatchQueue', () => {
  it('returns a group once enough players wait in the same mode', () => {
    const queue = new MatchQueue<P>((p) => p.id);
    expect(queue.enqueue('ranked', { id: 1 })).toBeNull();
    expect(queue.enqueue('casual', { id: 2 })).toBeNull();
    expect(queue.enqueue('ranked', { id: 3 })).toEqual([{ id: 1 }, { id: 3 }]);
    expect(queue.length('ranked')).toBe(0);
    expect(queue.length('casual')).toBe(1);
  });

  it('does not queue the same player twice', () => {
    const queue = new MatchQueue<P>((p) => p.id);
    queue.enqueue('ranked', { id: 1 });
    expect(queue.enqueue('ranked', { id: 1 })).toBeNull();
    expect(queue.length('ranked')).toBe(1);
  });

  it('hands out players who waited too long, e.g. for a bot match', () => {
    const queue = new MatchQueue<P>((p) => p.id);
    queue.enqueue('ranked', { id: 1 }, 0);
    queue.enqueue('casual', { id: 2 }, 0);
    expect(queue.takeWaitingLongerThan('ranked', 10_000, 9_999)).toEqual([]);
    expect(queue.takeWaitingLongerThan('ranked', 10_000, 10_000)).toEqual([{ id: 1 }]);
    expect(queue.has(1)).toBe(false);
    expect(queue.has(2)).toBe(true);
  });
});

describe('TurnTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once at the deadline and can be restarted', () => {
    const timer = new TurnTimer();
    const onExpire = vi.fn();
    timer.start(30_000, onExpire, 0);
    expect(timer.deadline).toBe(30_000);
    expect(timer.remainingMs(10_000)).toBe(20_000);
    vi.advanceTimersByTime(20_000);
    timer.start(30_000, onExpire, 20_000);
    vi.advanceTimersByTime(29_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(timer.running).toBe(false);
  });
});
