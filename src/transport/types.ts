import type { Server as HttpServer } from 'node:http';

/** One client connection, independent of the wire protocol. */
export interface ClientSocket {
  readonly id: string;
  /** Name of the transport that created it, e.g. 'socket.io', 'ws', 'memory'. */
  readonly transport: string;
  send(event: string, data?: unknown): void;
  close(): void;
}

/** Callbacks a transport reports to. Implemented by GameServer. */
export interface TransportHandlers {
  onConnect(socket: ClientSocket): void;
  onMessage(socket: ClientSocket, event: string, data: unknown): void;
  onDisconnect(socket: ClientSocket, reason: string): void;
}

export interface CorsOptions {
  origin: string | string[] | boolean;
}

export interface TransportContext {
  /** Null for transports that do not use HTTP (memory). */
  httpServer: HttpServer | null;
  handlers: TransportHandlers;
  cors?: CorsOptions;
}

export interface Transport {
  readonly name: string;
  /** True when the transport needs an HTTP server. */
  readonly needsHttp: boolean;
  attach(context: TransportContext): void;
  close(): Promise<void>;
}
