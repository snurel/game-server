export interface IdGeneratorOptions {
  /** Smallest id (inclusive). Default 1000. */
  min?: number;
  /** Largest id (inclusive). Default 9999. */
  max?: number;
  /** Random source in [0, 1). Default Math.random. */
  random?: () => number;
}

/**
 * Hands out short, unique, human-friendly ids from a fixed range.
 * Ids must be released when no longer used; when the range is full, next() throws
 * instead of looping forever.
 */
export class IdGenerator {
  private readonly used = new Set<number>();
  private readonly min: number;
  private readonly size: number;
  private readonly random: () => number;

  constructor(options: IdGeneratorOptions = {}) {
    this.min = options.min ?? 1000;
    const max = options.max ?? 9999;
    if (max < this.min) throw new RangeError('IdGenerator: max must be >= min');
    this.size = max - this.min + 1;
    this.random = options.random ?? Math.random;
  }

  next(): number {
    if (this.used.size >= this.size) {
      throw new Error(`IdGenerator: all ${this.size} ids are in use`);
    }
    // Random start, then linear probe: always terminates.
    const start = Math.floor(this.random() * this.size);
    for (let i = 0; i < this.size; i++) {
      const id = this.min + ((start + i) % this.size);
      if (!this.used.has(id)) {
        this.used.add(id);
        return id;
      }
    }
    throw new Error('IdGenerator: unreachable');
  }

  release(id: number): void {
    this.used.delete(id);
  }

  isUsed(id: number): boolean {
    return this.used.has(id);
  }

  get inUse(): number {
    return this.used.size;
  }
}
