export type BaseGameStatus = 'NOT_STARTED' | 'STARTED' | 'OVER';

export interface GameOverParams {
  /** Why the game ended, e.g. 'win', 'timeout', 'opponent_left'. */
  reason?: string;
  winnerId?: number;
  [key: string]: unknown;
}

/**
 * Base class for one match. Subclasses add players and rules.
 * `TStatus` lets a game add its own phases (e.g. 'SETUP' | 'BATTLE').
 */
export abstract class Game<TStatus extends string = BaseGameStatus> {
  protected status: TStatus | BaseGameStatus = 'NOT_STARTED';
  protected overParams: GameOverParams | undefined;

  constructor(readonly id: number) {}

  /** Room name for broadcasting to this game's clients. */
  get roomId(): string {
    return `game:${this.id}`;
  }

  getStatus(): TStatus | BaseGameStatus {
    return this.status;
  }

  isOver(): boolean {
    return this.status === 'OVER';
  }

  getOverParams(): GameOverParams | undefined {
    return this.overParams;
  }

  /** Called on every server tick while the game is not over. Override for timers. */
  update(_tick: number, _now: number): void {}

  /** Marks the game as over. Override to notify players, then call super. */
  end(params: GameOverParams = {}): void {
    this.status = 'OVER';
    this.overParams = params;
  }

  /** Called when the game is removed from its manager: clear timers here. */
  dispose(): void {}

  abstract start(): void;
}
