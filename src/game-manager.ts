import type { Game } from './game';
import { IdGenerator } from './ids';

/** Owns the live games: creates them with unique ids, ticks and removes them. */
export class GameManager<TGame extends Game<any>> {
  private readonly games = new Map<number, TGame>();

  constructor(private readonly ids: IdGenerator = new IdGenerator()) {}

  create(factory: (id: number) => TGame): TGame {
    const id = this.ids.next();
    try {
      const game = factory(id);
      this.games.set(id, game);
      return game;
    } catch (error) {
      this.ids.release(id);
      throw error;
    }
  }

  get(id: number): TGame | undefined {
    return this.games.get(id);
  }

  all(): IterableIterator<TGame> {
    return this.games.values();
  }

  /** Disposes the game and frees its id. */
  remove(id: number): boolean {
    const game = this.games.get(id);
    if (!game) return false;
    this.games.delete(id);
    this.ids.release(id);
    game.dispose();
    return true;
  }

  /** Calls update() on every game that is not over. Errors are reported, not thrown. */
  tick(tick: number, now: number, onError?: (game: TGame, error: unknown) => void): void {
    for (const game of this.games.values()) {
      if (game.isOver()) continue;
      try {
        game.update(tick, now);
      } catch (error) {
        onError?.(game, error);
      }
    }
  }

  get size(): number {
    return this.games.size;
  }
}
