/**
 * One countdown, e.g. a player's turn. Send `deadline` to clients so they can
 * show the remaining time without trusting their own clock for the rule.
 */
export class TurnTimer {
  private timer: NodeJS.Timeout | null = null;
  private deadlineAt: number | null = null;

  /** Starts (or restarts) the countdown. */
  start(durationMs: number, onExpire: () => void, now = Date.now()): void {
    this.stop();
    this.deadlineAt = now + durationMs;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadlineAt = null;
      onExpire();
    }, durationMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadlineAt = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Epoch ms when the countdown ends, or null when stopped. */
  get deadline(): number | null {
    return this.deadlineAt;
  }

  remainingMs(now = Date.now()): number {
    return this.deadlineAt === null ? 0 : Math.max(0, this.deadlineAt - now);
  }
}
