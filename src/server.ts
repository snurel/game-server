import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Command, CommandContext } from './command';
import { PayloadError } from './command';
import type { Connection } from './connection';
import { ConnectionManager } from './connection-manager';
import { ErrorCodes, SystemEvents, type ErrorPayload } from './events';
import type { Game } from './game';
import { GameManager } from './game-manager';
import { IdGenerator } from './ids';
import { ConsoleLogger, type Logger } from './logger';
import { RoomRegistry } from './rooms';
import { MemoryTransport, type MemoryClient, type MemoryClientOptions } from './transport/memory';
import type { ClientSocket, CorsOptions, Transport, TransportHandlers } from './transport/types';

export interface GameServerOptions {
  /** Network transports, e.g. [new SocketIOTransport(), new WebSocketTransport()]. */
  transports?: Transport[];
  /**
   * Existing HTTP server (e.g. from an Express app) to attach to. When given,
   * the app is responsible for calling listen() unless `port` is also set.
   */
  httpServer?: HttpServer;
  /** Port to listen on. 0 picks a free port. Default 5200 when no httpServer is given. */
  port?: number;
  host?: string;
  /** Allowed browser origins for network transports. Default: none restricted ('*'). */
  cors?: CorsOptions;
  logger?: Logger;
  /** Interval for Game.update() calls in ms. 0 disables ticking. Default 1000. */
  tickIntervalMs?: number;
  /** Id range for games. */
  gameIds?: IdGenerator;
}

type ConnectionHook<TData> = (connection: Connection<TData>) => void;
type DisconnectHook<TData> = (connection: Connection<TData>, reason: string) => void;

/**
 * Wires transports, connections, commands, rooms and games together.
 * Create one per process (or several in tests); nothing is global.
 */
export class GameServer<TGame extends Game<any> = Game<any>, TData = unknown> {
  readonly connections = new ConnectionManager<TData>();
  readonly rooms = new RoomRegistry();
  readonly games: GameManager<TGame>;
  readonly logger: Logger;

  private readonly commands = new Map<string, Command<any, TData>>();
  private readonly pending = new WeakMap<ClientSocket, Promise<void>>();
  private readonly connectHooks: ConnectionHook<TData>[] = [];
  private readonly disconnectHooks: DisconnectHook<TData>[] = [];
  private readonly transports: Transport[];
  private readonly memory = new MemoryTransport();
  private readonly options: GameServerOptions;
  private httpServer: HttpServer | null;
  private ownsHttpServer = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private started = false;

  constructor(options: GameServerOptions = {}) {
    this.options = options;
    this.logger = options.logger ?? new ConsoleLogger();
    this.games = new GameManager<TGame>(options.gameIds);
    this.transports = [...(options.transports ?? []), this.memory];
    this.httpServer = options.httpServer ?? null;
  }

  /** Registers a handler for a client event. Accepts a Command or a plain function. */
  command<TPayload>(
    event: string,
    command: Command<TPayload, TData> | ((context: CommandContext<TData>, payload: TPayload) => void | Promise<void>),
  ): this {
    if (event === SystemEvents.Error) throw new Error(`'${event}' is reserved`);
    if (this.commands.has(event)) throw new Error(`A command for '${event}' is already registered`);
    this.commands.set(event, typeof command === 'function' ? { handle: command } : command);
    return this;
  }

  onConnect(hook: ConnectionHook<TData>): this {
    this.connectHooks.push(hook);
    return this;
  }

  /** Called after a client is gone. The connection has already left its rooms. */
  onDisconnect(hook: DisconnectHook<TData>): this {
    this.disconnectHooks.push(hook);
    return this;
  }

  async start(): Promise<{ port: number | null }> {
    if (this.started) throw new Error('GameServer already started');
    this.started = true;

    const needsHttp = this.transports.some((t) => t.needsHttp);
    if (needsHttp && !this.httpServer) {
      this.httpServer = createServer((_req, res) => {
        res.writeHead(404).end();
      });
      this.ownsHttpServer = true;
    }

    const handlers = this.createHandlers();
    for (const transport of this.transports) {
      transport.attach({
        httpServer: transport.needsHttp ? this.httpServer : null,
        handlers,
        cors: this.options.cors,
      });
    }

    let port: number | null = null;
    const listenPort = this.options.port ?? (this.ownsHttpServer ? 5200 : undefined);
    if (this.httpServer && listenPort !== undefined && !this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.once('error', reject);
        this.httpServer!.listen(listenPort, this.options.host, () => {
          this.httpServer!.off('error', reject);
          resolve();
        });
      });
    }
    if (this.httpServer?.listening) port = (this.httpServer.address() as AddressInfo).port;

    const tickMs = this.options.tickIntervalMs ?? 1000;
    if (tickMs > 0) {
      this.tickTimer = setInterval(() => this.tick(), tickMs);
      this.tickTimer.unref();
    }

    this.logger.info(
      `GameServer started (${this.transports.map((t) => t.name).join(', ')})${port !== null ? ` on port ${port}` : ''}`,
    );
    return { port };
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const transport of this.transports) await transport.close();
    if (this.ownsHttpServer && this.httpServer?.listening) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
    }
    for (const game of [...this.games.all()]) this.games.remove(game.id);
    this.started = false;
  }

  /** Runs one tick now. Called automatically every `tickIntervalMs`. */
  tick(now = Date.now()): void {
    this.tickCount += 1;
    this.games.tick(this.tickCount, now, (game, error) =>
      this.logger.error(`Game ${game.id} update failed`, error),
    );
  }

  /**
   * An in-process client that talks to this server like a network client.
   * Use it for bots and tests. Requires start().
   */
  createVirtualClient(options?: MemoryClientOptions): MemoryClient {
    return this.memory.connect(options);
  }

  /** Number of connected virtual clients (bots, tests). */
  get virtualClients(): number {
    return this.memory.size;
  }

  broadcast(room: string, event: string, data?: unknown, except?: Connection<TData>): void {
    this.rooms.broadcast(room, event, data, except);
  }

  /** Sends a SystemEvents.Error to one connection. */
  sendError(connection: Connection<TData>, error: ErrorPayload): void {
    connection.send(SystemEvents.Error, error);
  }

  get http(): HttpServer | null {
    return this.httpServer;
  }

  private createHandlers(): TransportHandlers {
    return {
      onConnect: (socket) => this.handleConnect(socket),
      onMessage: (socket, event, data) => this.enqueueMessage(socket, event, data),
      onDisconnect: (socket, reason) => this.handleDisconnect(socket, reason),
    };
  }

  private handleConnect(socket: ClientSocket): void {
    const connection = this.connections.add(socket);
    this.logger.debug(`connect ${socket.transport}:${socket.id}`);
    this.runHooks(this.connectHooks, connection);
  }

  /**
   * Messages from one client are handled strictly in order: if a command is
   * async, the next message from the same socket waits for it.
   */
  private enqueueMessage(socket: ClientSocket, event: string, raw: unknown): void {
    const busy = this.pending.get(socket);
    const result = busy
      ? busy.then(() => this.dispatch(socket, event, raw))
      : this.dispatch(socket, event, raw);
    if (!result) return;
    this.pending.set(socket, result);
    void result.finally(() => {
      if (this.pending.get(socket) === result) this.pending.delete(socket);
    });
  }

  /** Runs one message. Returns a promise only when the command is async. Never throws. */
  private dispatch(socket: ClientSocket, event: string, raw: unknown): Promise<void> | void {
    const connection = this.connections.get(socket.id);
    if (!connection) return;
    this.logger.debug(`message ${socket.id} ${event}`);

    const command = this.commands.get(event);
    if (!command) {
      this.sendError(connection, { code: ErrorCodes.UnknownEvent, event });
      return;
    }

    let payload: unknown = raw;
    if (command.parse) {
      try {
        payload = command.parse(raw);
      } catch (error) {
        const message = error instanceof PayloadError ? error.message : undefined;
        this.sendError(connection, { code: ErrorCodes.InvalidPayload, event, message });
        return;
      }
    }

    const fail = (error: unknown): void => {
      this.logger.error(`Command '${event}' failed`, error);
      this.sendError(connection, { code: ErrorCodes.InternalError, event });
    };
    try {
      const result = command.handle({ server: this, connection, event }, payload);
      if (result instanceof Promise) return result.catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  private handleDisconnect(socket: ClientSocket, reason: string): void {
    const connection = this.connections.get(socket.id);
    if (!connection || connection.socket !== socket) return; // already re-bound to a newer socket
    this.rooms.leaveAll(connection);
    this.connections.remove(connection);
    this.logger.debug(`disconnect ${socket.id} (${reason})`);
    for (const hook of this.disconnectHooks) {
      try {
        hook(connection, reason);
      } catch (error) {
        this.logger.error('onDisconnect hook failed', error);
      }
    }
  }

  private runHooks(hooks: ConnectionHook<TData>[], connection: Connection<TData>): void {
    for (const hook of hooks) {
      try {
        hook(connection);
      } catch (error) {
        this.logger.error('onConnect hook failed', error);
      }
    }
  }
}
