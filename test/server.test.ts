import { afterEach, describe, expect, it } from 'vitest';
import { GameServer, Game, PayloadError, silentLogger, ErrorCodes, SystemEvents } from '../src';

class TestGame extends Game<'SETUP' | 'PLAY'> {
  updates = 0;
  disposed = false;
  start(): void {
    this.status = 'PLAY';
  }
  override update(): void {
    this.updates += 1;
  }
  override dispose(): void {
    this.disposed = true;
  }
}

let server: GameServer<TestGame, { name: string }>;

async function startServer(): Promise<void> {
  server = new GameServer<TestGame, { name: string }>({ logger: silentLogger, tickIntervalMs: 0 });
  await server.start();
}

afterEach(async () => {
  await server?.stop();
});

describe('GameServer commands', () => {
  it('routes an event to its command and replies', async () => {
    await startServer();
    server.command<{ text: string }>('echo', ({ connection }, payload) => {
      connection.send('echoed', payload.text.toUpperCase());
    });
    const client = server.createVirtualClient();
    client.send('echo', { text: 'hi' });
    await expect(client.waitFor('echoed')).resolves.toBe('HI');
  });

  it('rejects invalid payloads with invalid_payload and does not run the handler', async () => {
    await startServer();
    let ran = false;
    server.command<{ n: number }>('add', {
      parse(raw) {
        const n = (raw as { n?: unknown } | null)?.n;
        if (typeof n !== 'number') throw new PayloadError('n must be a number');
        return { n };
      },
      handle() {
        ran = true;
      },
    });
    const client = server.createVirtualClient();
    client.send('add', { n: 'x' });
    const error = await client.waitFor(SystemEvents.Error);
    expect(error).toEqual({ code: ErrorCodes.InvalidPayload, event: 'add', message: 'n must be a number' });
    expect(ran).toBe(false);
  });

  it('survives a throwing handler and reports internal_error', async () => {
    await startServer();
    server.command('boom', () => {
      throw new Error('bug');
    });
    server.command('ping', ({ connection }) => connection.send('pong'));
    const client = server.createVirtualClient();
    client.send('boom');
    await expect(client.waitFor(SystemEvents.Error)).resolves.toEqual({
      code: ErrorCodes.InternalError,
      event: 'boom',
    });
    client.send('ping');
    await expect(client.waitFor('pong')).resolves.toBeUndefined();
  });

  it('also catches async handler failures', async () => {
    await startServer();
    server.command('later', async () => {
      await Promise.resolve();
      throw new Error('async bug');
    });
    const client = server.createVirtualClient();
    client.send('later');
    await expect(client.waitFor(SystemEvents.Error)).resolves.toMatchObject({ code: ErrorCodes.InternalError });
  });

  it('handles messages from one client in order, even when commands are async', async () => {
    await startServer();
    const log: string[] = [];
    server.command<string>('slow', async (_ctx, id) => {
      await new Promise((r) => setTimeout(r, 20));
      log.push(id);
    });
    server.command<string>('fast', ({ connection }, id) => {
      log.push(id);
      connection.send('done');
    });
    const client = server.createVirtualClient();
    client.send('slow', 'a');
    client.send('fast', 'b');
    await client.waitFor('done');
    expect(log).toEqual(['a', 'b']);
  });

  it('reports unknown events', async () => {
    await startServer();
    const client = server.createVirtualClient();
    client.send('nope');
    await expect(client.waitFor(SystemEvents.Error)).resolves.toEqual({ code: ErrorCodes.UnknownEvent, event: 'nope' });
  });

  it('refuses duplicate and reserved command names', async () => {
    await startServer();
    server.command('a', () => {});
    expect(() => server.command('a', () => {})).toThrow(/already/);
    expect(() => server.command(SystemEvents.Error, () => {})).toThrow(/reserved/);
  });
});

describe('GameServer rooms and connections', () => {
  it('broadcasts to a room, optionally skipping the sender', async () => {
    await startServer();
    server.command('join', ({ connection }) => server.rooms.join('lobby', connection));
    server.command('say', ({ connection }, text) => server.broadcast('lobby', 'said', text, connection));
    const a = server.createVirtualClient();
    const b = server.createVirtualClient();
    a.send('join');
    b.send('join');
    a.send('say', 'hello');
    await expect(b.waitFor('said')).resolves.toBe('hello');
    await Promise.resolve();
    expect(a.received.filter((m) => m.event === 'said')).toEqual([]);
  });

  it('removes a disconnected client from rooms and calls onDisconnect', async () => {
    await startServer();
    const gone: string[] = [];
    server.onDisconnect((conn, reason) => gone.push(reason));
    server.command('join', ({ connection }) => server.rooms.join('r', connection));
    const client = server.createVirtualClient();
    client.send('join');
    expect(server.rooms.members('r')).toHaveLength(1);
    client.disconnect('bye');
    expect(server.rooms.members('r')).toHaveLength(0);
    expect(gone).toEqual(['bye']);
    expect(server.connections.size).toBe(0);
  });

  it('keeps rooms and data when a connection is re-bound to a new socket', async () => {
    await startServer();
    server.command('hello', ({ connection }, name) => {
      const known = server.connections.getByIdentifier(name as string);
      if (known && known !== connection) {
        server.connections.rebind(known, connection);
        known.send('welcomeBack', known.data?.name);
        return;
      }
      connection.data = { name: name as string };
      server.connections.identify(connection, name as string);
      server.rooms.join('game:1', connection);
    });
    const first = server.createVirtualClient();
    first.send('hello', 'ada');
    const second = server.createVirtualClient();
    second.send('hello', 'ada');
    await expect(second.waitFor('welcomeBack')).resolves.toBe('ada');
    // The old socket closing later must not tear down the re-bound connection.
    first.disconnect();
    expect(server.rooms.members('game:1')).toHaveLength(1);
    server.broadcast('game:1', 'state', 1);
    await expect(second.waitFor('state')).resolves.toBe(1);
  });
});

describe('virtual clients', () => {
  it('receive messages sent right before the server closes them', async () => {
    await startServer();
    server.command('leave', ({ connection }) => {
      connection.send('bye', 'see you');
      connection.close();
    });
    const client = server.createVirtualClient();
    const bye = client.waitFor('bye');
    client.send('leave');
    await expect(bye).resolves.toBe('see you');
    await Promise.resolve();
    expect(client.isConnected).toBe(false);
  });
});

describe('virtual client lifecycle', () => {
  it('forgets disconnected clients and can skip recording messages', async () => {
    await startServer();
    server.command('ping', ({ connection }) => connection.send('pong'));
    const quiet = server.createVirtualClient({ record: false });
    const pong = quiet.waitFor('pong');
    quiet.send('ping');
    await pong;
    expect(quiet.received).toEqual([]);
    expect(server.virtualClients).toBe(1);
    quiet.disconnect();
    expect(server.virtualClients).toBe(0);
  });
});

describe('GameServer games', () => {
  it('ticks running games, skips finished ones and disposes on remove', async () => {
    await startServer();
    const a = server.games.create((id) => new TestGame(id));
    const b = server.games.create((id) => new TestGame(id));
    a.start();
    b.end({ reason: 'test' });
    server.tick();
    server.tick();
    expect(a.updates).toBe(2);
    expect(b.updates).toBe(0);
    expect(a.getStatus()).toBe('PLAY');
    expect(a.roomId).toBe(`game:${a.id}`);
    server.games.remove(a.id);
    expect(a.disposed).toBe(true);
    expect(server.games.get(a.id)).toBeUndefined();
  });

  it('disposes all games on stop', async () => {
    await startServer();
    const game = server.games.create((id) => new TestGame(id));
    await server.stop();
    expect(game.disposed).toBe(true);
    expect(server.games.size).toBe(0);
  });
});
