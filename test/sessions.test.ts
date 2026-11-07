import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, SessionManager, type Session } from '../src';
import type { ClientSocket } from '../src';

const socket = (id: string): ClientSocket => ({ id, transport: 'test', send: () => {}, close: () => {} });
const conn = (id: string, identifier: string): Connection => {
  const c = new Connection(socket(id));
  c.identifier = identifier;
  return c;
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SessionManager', () => {
  it('resumes a session that reconnects inside the window', () => {
    const expired: Session<{ gameId: number }>[] = [];
    const sessions = new SessionManager<{ gameId: number }>({ reconnectWindowMs: 30_000, onExpire: (s) => expired.push(s) });
    const first = sessions.attach('dev-1', conn('s1', 'dev-1'));
    expect(first.resumed).toBe(false);
    first.session.state = { gameId: 7 };

    sessions.detach(first.session.connection!);
    vi.advanceTimersByTime(29_000);
    const again = sessions.attach('dev-1', conn('s2', 'dev-1'));

    expect(again.resumed).toBe(true);
    expect(again.session.state).toEqual({ gameId: 7 });
    vi.advanceTimersByTime(60_000);
    expect(expired).toEqual([]);
  });

  it('expires a session that does not come back', () => {
    const onExpire = vi.fn();
    const sessions = new SessionManager({ reconnectWindowMs: 1000, onExpire });
    const { session } = sessions.attach('dev-1', conn('s1', 'dev-1'));
    sessions.detach(session.connection!);
    vi.advanceTimersByTime(1000);
    expect(onExpire).toHaveBeenCalledWith(session);
    expect(sessions.get('dev-1')).toBeUndefined();
  });

  it('ignores a stale connection detaching after the session moved on', () => {
    const sessions = new SessionManager({ reconnectWindowMs: 1000 });
    const old = conn('s1', 'dev-1');
    sessions.attach('dev-1', old);
    sessions.attach('dev-1', conn('s2', 'dev-1'));
    expect(sessions.detach(old)).toBeUndefined();
    expect(sessions.get('dev-1')?.connection?.id).toBe('s2');
  });
});
