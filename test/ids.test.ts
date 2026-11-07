import { describe, expect, it } from 'vitest';
import { IdGenerator } from '../src/ids';

describe('IdGenerator', () => {
  it('throws instead of looping forever when the range is full', () => {
    const ids = new IdGenerator({ min: 1, max: 3 });
    const taken = [ids.next(), ids.next(), ids.next()];
    expect(new Set(taken)).toEqual(new Set([1, 2, 3]));
    expect(() => ids.next()).toThrow(/in use/);
  });

  it('reuses released ids', () => {
    const ids = new IdGenerator({ min: 1, max: 2 });
    const a = ids.next();
    ids.next();
    ids.release(a);
    expect(ids.next()).toBe(a);
  });

  it('stays inside the range', () => {
    const ids = new IdGenerator();
    for (let i = 0; i < 500; i++) {
      const id = ids.next();
      expect(id).toBeGreaterThanOrEqual(1000);
      expect(id).toBeLessThanOrEqual(9999);
    }
    expect(ids.inUse).toBe(500);
  });
});
