import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { WebSocket } from 'ws';
import { GameServer, silentLogger, SystemEvents, ErrorCodes } from '../src';
import { SocketIOTransport } from '../src/transport/socket-io';
import { WebSocketTransport } from '../src/transport/ws';

let server: GameServer;
const openClients: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const c of openClients.splice(0)) c.close();
  await server?.stop();
});

async function startBoth(): Promise<number> {
  server = new GameServer({
    transports: [new SocketIOTransport(), new WebSocketTransport({ path: '/ws', heartbeatMs: 0 })],
    port: 0,
    logger: silentLogger,
    tickIntervalMs: 0,
  });
  server.command('echo', ({ connection }, data) => connection.send('echoed', { data, via: connection.transport }));
  server.command('join', ({ connection }) => server.rooms.join('all', connection));
  server.command('shout', (_ctx, data) => server.broadcast('all', 'shouted', data));
  const { port } = await server.start();
  return port!;
}

function socketIo(port: number): Socket {
  const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  openClients.push({ close: () => socket.close() });
  return socket;
}

async function ws(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${port}/ws`);
  openClients.push({ close: () => socket.close() });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

function nextFrame(socket: WebSocket, event: string): Promise<unknown> {
  return new Promise((resolve) => {
    const onMessage = (raw: Buffer): void => {
      const frame = JSON.parse(raw.toString()) as { event: string; data: unknown };
      if (frame.event === event) {
        socket.off('message', onMessage);
        resolve(frame.data);
      }
    };
    socket.on('message', onMessage);
  });
}

describe('transports on one HTTP server', () => {
  it('serves Socket.IO and plain WebSocket clients side by side', async () => {
    const port = await startBoth();

    const sio = socketIo(port);
    const sioReply = new Promise((resolve) => sio.once('echoed', resolve));
    sio.emit('echo', 1);
    await expect(sioReply).resolves.toEqual({ data: 1, via: 'socket.io' });

    const plain = await ws(port);
    const wsReply = nextFrame(plain, 'echoed');
    plain.send(JSON.stringify({ event: 'echo', data: 2 }));
    await expect(wsReply).resolves.toEqual({ data: 2, via: 'ws' });
  });

  it('broadcasts across transports in one room', async () => {
    const port = await startBoth();
    const sio = socketIo(port);
    const plain = await ws(port);
    await new Promise<void>((resolve) => sio.on('connect', () => resolve()));

    sio.emit('join');
    plain.send(JSON.stringify({ event: 'join' }));
    await new Promise((r) => setTimeout(r, 50));

    const toSio = new Promise((resolve) => sio.once('shouted', resolve));
    const toWs = nextFrame(plain, 'shouted');
    plain.send(JSON.stringify({ event: 'shout', data: 'hey' }));
    await expect(Promise.all([toSio, toWs])).resolves.toEqual(['hey', 'hey']);
  });

  it('answers a malformed WebSocket frame with bad_frame', async () => {
    const port = await startBoth();
    const plain = await ws(port);
    const reply = nextFrame(plain, SystemEvents.Error);
    plain.send('not json');
    await expect(reply).resolves.toMatchObject({ code: ErrorCodes.BadFrame });
  });

  it('attaches to an existing HTTP server the app owns', async () => {
    const http = createServer((_req, res) => res.end('api'));
    server = new GameServer({
      httpServer: http,
      transports: [new WebSocketTransport({ heartbeatMs: 0 })],
      logger: silentLogger,
      tickIntervalMs: 0,
    });
    server.command('echo', ({ connection }, data) => connection.send('echoed', data));
    await server.start();
    await new Promise<void>((resolve) => http.listen(0, resolve));
    const port = (http.address() as { port: number }).port;

    const res = await fetch(`http://localhost:${port}/story`);
    expect(await res.text()).toBe('api');

    const plain = await ws(port);
    const reply = nextFrame(plain, 'echoed');
    plain.send(JSON.stringify({ event: 'echo', data: 'x' }));
    await expect(reply).resolves.toBe('x');

    for (const c of openClients.splice(0)) c.close();
    await server.stop();
    await new Promise((r) => http.close(r));
  });
});
