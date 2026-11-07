import type { Connection } from './connection';

export interface Session<TState = unknown> {
  readonly identifier: string;
  connection: Connection<any> | undefined;
  /** App state that must survive a reconnect, e.g. { playerId, gameId }. */
  state: TState | undefined;
  disconnectedAt: number | undefined;
}

export interface SessionManagerOptions<TState> {
  /** How long a dropped client may take to come back. Default 30000 ms. */
  reconnectWindowMs?: number;
  /** Called when a disconnected session was not resumed in time. */
  onExpire?: (session: Session<TState>) => void;
}

/**
 * Keeps a client's identity across reconnects. A session is keyed by a stable
 * identifier (device or account id). When its connection drops, the session is
 * kept for `reconnectWindowMs`; attaching the same identifier again resumes it.
 */
export class SessionManager<TState = unknown> {
  private readonly sessions = new Map<string, Session<TState>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly windowMs: number;
  private readonly onExpire: ((session: Session<TState>) => void) | undefined;

  constructor(options: SessionManagerOptions<TState> = {}) {
    this.windowMs = options.reconnectWindowMs ?? 30_000;
    this.onExpire = options.onExpire;
  }

  /** Binds a connection to an identifier. `resumed` is true if it came back in time. */
  attach(identifier: string, connection: Connection<any>): { session: Session<TState>; resumed: boolean } {
    const existing = this.sessions.get(identifier);
    if (existing) {
      const resumed = existing.disconnectedAt !== undefined;
      this.clearTimer(identifier);
      existing.connection = connection;
      existing.disconnectedAt = undefined;
      return { session: existing, resumed };
    }
    const session: Session<TState> = { identifier, connection, state: undefined, disconnectedAt: undefined };
    this.sessions.set(identifier, session);
    return { session, resumed: false };
  }

  /** Marks the session of this connection as disconnected and starts the reconnect window. */
  detach(connection: Connection<any>, now = Date.now()): Session<TState> | undefined {
    const identifier = connection.identifier;
    if (!identifier) return undefined;
    const session = this.sessions.get(identifier);
    if (!session || session.connection !== connection) return undefined;
    session.connection = undefined;
    session.disconnectedAt = now;
    this.clearTimer(identifier);
    const timer = setTimeout(() => {
      this.timers.delete(identifier);
      if (this.sessions.get(identifier) !== session || session.disconnectedAt === undefined) return;
      this.sessions.delete(identifier);
      this.onExpire?.(session);
    }, this.windowMs);
    timer.unref?.();
    this.timers.set(identifier, timer);
    return session;
  }

  get(identifier: string): Session<TState> | undefined {
    return this.sessions.get(identifier);
  }

  /** Ends a session for good (e.g. after the game is over). */
  end(identifier: string): void {
    this.clearTimer(identifier);
    this.sessions.delete(identifier);
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }

  private clearTimer(identifier: string): void {
    const timer = this.timers.get(identifier);
    if (timer) clearTimeout(timer);
    this.timers.delete(identifier);
  }
}
