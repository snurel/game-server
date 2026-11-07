/** Minimal player record. Extend it for game-specific state. */
export class Player {
  gameId: number | undefined;
  connected = true;

  constructor(
    readonly id: number,
    readonly name: string,
    /** Stable client identifier, used to find the player again after a reconnect. */
    readonly identifier?: string,
    /** Bots have no network client; the app drives them in-process. */
    readonly isBot = false,
  ) {}
}
