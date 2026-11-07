import type { ClientSocket, Transport, TransportContext, TransportHandlers } from './types';

interface Received {
  event: string;
  data: unknown;
}

type Listener = (data: unknown) => void;

export interface MemoryClientOptions {
  /**
   * Keep every received message in `received` (handy in tests). Turn it off for
   * long-lived clients such as bots so memory does not grow. Default true.
   */
  record?: boolean;
}

/**
 * In-process client: for bots and tests. Speaks the same events as a network
 * client. Server-to-client messages are delivered asynchronously (microtask).
 */
export class MemoryClient {
  readonly received: Received[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();
  private connected = true;

  constructor(
    readonly id: string,
    private readonly handlers: TransportHandlers,
    private readonly socket: ClientSocket,
    private readonly record = true,
    private readonly onClosed: () => void = () => {},
  ) {}

  /** Client -> server. */
  send(event: string, data?: unknown): void {
    if (!this.connected) throw new Error(`MemoryClient ${this.id} is disconnected`);
    this.handlers.onMessage(this.socket, event, data);
  }

  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Resolves with the next payload of `event`, or rejects after `timeoutMs`. */
  waitFor<T = unknown>(event: string, timeoutMs = 1000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`MemoryClient ${this.id}: timed out waiting for '${event}'`));
      }, timeoutMs);
      const off = this.on(event, (data) => {
        clearTimeout(timer);
        off();
        resolve(data as T);
      });
    });
  }

  disconnect(reason = 'client disconnect'): void {
    if (!this.connected) return;
    this.connected = false;
    this.listeners.clear();
    this.onClosed();
    this.handlers.onDisconnect(this.socket, reason);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** @internal Server -> client delivery. */
  deliver(event: string, data: unknown): void {
    if (!this.connected) return;
    queueMicrotask(() => {
      if (!this.connected) return;
      if (this.record) this.received.push({ event, data });
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(data);
    });
  }

  /**
   * @internal Server closed the connection. Deferred so messages the server
   * sent just before closing are still delivered, like a real socket flush.
   */
  closedByServer(): void {
    queueMicrotask(() => this.disconnect('server disconnect'));
  }
}

export class MemoryTransport implements Transport {
  readonly name = 'memory';
  readonly needsHttp = false;
  private handlers: TransportHandlers | null = null;
  private counter = 0;
  private readonly clients = new Set<MemoryClient>();

  attach(context: TransportContext): void {
    this.handlers = context.handlers;
  }

  connect(options: MemoryClientOptions = {}): MemoryClient {
    const handlers = this.handlers;
    if (!handlers) throw new Error('MemoryTransport is not attached to a server yet');
    const id = `mem-${++this.counter}`;
    let client: MemoryClient | undefined;
    const socket: ClientSocket = {
      id,
      transport: this.name,
      send: (event, data) => client?.deliver(event, data),
      close: () => client?.closedByServer(),
    };
    client = new MemoryClient(id, handlers, socket, options.record ?? true, () => this.clients.delete(client!));
    this.clients.add(client);
    handlers.onConnect(socket);
    return client;
  }

  async close(): Promise<void> {
    for (const client of [...this.clients]) client.closedByServer();
    this.clients.clear();
  }

  /** Number of connected in-process clients. */
  get size(): number {
    return this.clients.size;
  }
}
