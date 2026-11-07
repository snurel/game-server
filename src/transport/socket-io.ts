import { Server, type ServerOptions, type Socket } from 'socket.io';
import type { ClientSocket, Transport, TransportContext } from './types';

/**
 * Socket.IO transport. Events map 1:1 to Socket.IO events.
 * Import from '@sametnurel/game-server/socket-io' (needs the `socket.io` package).
 */
export class SocketIOTransport implements Transport {
  readonly name = 'socket.io';
  readonly needsHttp = true;
  private io: Server | null = null;

  constructor(private readonly options: Partial<ServerOptions> = {}) {}

  attach({ httpServer, handlers, cors }: TransportContext): void {
    if (!httpServer) throw new Error('SocketIOTransport needs an HTTP server');
    this.io = new Server(httpServer, { cors, ...this.options });

    this.io.on('connection', (raw: Socket) => {
      const socket: ClientSocket = {
        id: raw.id,
        transport: this.name,
        send: (event, data) => {
          raw.emit(event, data);
        },
        close: () => {
          raw.disconnect(true);
        },
      };
      handlers.onConnect(socket);
      raw.onAny((event: string, data: unknown) => handlers.onMessage(socket, event, data));
      raw.on('disconnect', (reason) => handlers.onDisconnect(socket, reason));
    });
  }

  /** The underlying Socket.IO server, for advanced use. */
  get server(): Server | null {
    return this.io;
  }

  async close(): Promise<void> {
    const io = this.io;
    this.io = null;
    if (!io) return;
    io.disconnectSockets(true);
    // Do not let Socket.IO close the shared HTTP server; GameServer owns it.
    io.engine.close();
    io.removeAllListeners();
  }
}
