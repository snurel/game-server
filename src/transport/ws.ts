import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { ErrorCodes, SystemEvents } from '../events';
import type { ClientSocket, Transport, TransportContext } from './types';

export interface WebSocketTransportOptions {
  /** URL path clients connect to. Default '/ws'. */
  path?: string;
  /** Max incoming frame size in bytes. Default 64 KiB. */
  maxPayload?: number;
  /** Ping interval to drop dead connections, in ms. 0 disables. Default 30000. */
  heartbeatMs?: number;
}

/**
 * Plain WebSocket transport (the `ws` package). Every frame is JSON:
 *   { "event": string, "data"?: any }
 * in both directions. Works with any WebSocket client (browser, Godot, mobile).
 * Import from '@sametnurel/game-server/ws'.
 */
export class WebSocketTransport implements Transport {
  readonly name = 'ws';
  readonly needsHttp = true;
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private detachUpgrade: (() => void) | null = null;
  private readonly path: string;
  private readonly maxPayload: number;
  private readonly heartbeatMs: number;

  constructor(options: WebSocketTransportOptions = {}) {
    this.path = options.path ?? '/ws';
    this.maxPayload = options.maxPayload ?? 64 * 1024;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
  }

  attach({ httpServer, handlers, cors }: TransportContext): void {
    if (!httpServer) throw new Error('WebSocketTransport needs an HTTP server');
    const wss = new WebSocketServer({ noServer: true, maxPayload: this.maxPayload });
    this.wss = wss;
    const alive = new WeakMap<WebSocket, boolean>();

    // Only take upgrades for our path; leave the rest (e.g. Socket.IO) alone.
    const onUpgrade = (req: IncomingMessage, stream: Duplex, head: Buffer): void => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (pathname !== this.path) return;
      if (!originAllowed(cors, req.headers.origin)) {
        stream.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, stream, head, (ws) => wss.emit('connection', ws, req));
    };
    httpServer.on('upgrade', onUpgrade);
    this.detachUpgrade = () => httpServer.off('upgrade', onUpgrade);

    wss.on('connection', (ws: WebSocket) => {
      const socket: ClientSocket = {
        id: randomUUID(),
        transport: this.name,
        send: (event, data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event, data }));
        },
        close: () => ws.close(1000, 'server close'),
      };
      alive.set(ws, true);
      ws.on('pong', () => alive.set(ws, true));
      handlers.onConnect(socket);

      ws.on('message', (raw, isBinary) => {
        const frame = isBinary ? undefined : parseFrame(raw.toString());
        if (!frame) {
          socket.send(SystemEvents.Error, { code: ErrorCodes.BadFrame, message: 'Expected JSON {"event","data"}' });
          return;
        }
        handlers.onMessage(socket, frame.event, frame.data);
      });
      ws.on('close', (code) => handlers.onDisconnect(socket, `close ${code}`));
      ws.on('error', () => ws.terminate());
    });

    if (this.heartbeatMs > 0) {
      this.heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (alive.get(ws) === false) {
            ws.terminate();
            continue;
          }
          alive.set(ws, false);
          ws.ping();
        }
      }, this.heartbeatMs);
      this.heartbeat.unref();
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.detachUpgrade?.();
    this.detachUpgrade = null;
    const wss = this.wss;
    this.wss = null;
    if (!wss) return;
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
}

function parseFrame(text: string): { event: string; data: unknown } | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const { event, data } = value as { event?: unknown; data?: unknown };
    return typeof event === 'string' && event.length > 0 ? { event, data } : undefined;
  } catch {
    return undefined;
  }
}

function originAllowed(cors: TransportContext['cors'], origin: string | undefined): boolean {
  if (!cors || cors.origin === true || cors.origin === '*') return true;
  if (cors.origin === false) return origin === undefined;
  if (origin === undefined) return true; // non-browser clients (Godot, native) send no Origin
  return Array.isArray(cors.origin) ? cors.origin.includes(origin) : cors.origin === origin;
}
