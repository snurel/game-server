import type { ClientSocket } from './transport/types';

/**
 * A client as the game sees it. Wraps the current socket; on reconnect the same
 * Connection can be re-bound to a new socket so rooms and data survive.
 */
export class Connection<TData = unknown> {
  /** Free slot for app data, e.g. the player this client controls. */
  data: TData | undefined;
  /** Stable client identifier (device id, account id) once the app sets it. */
  identifier: string | undefined;
  readonly rooms = new Set<string>();
  private current: ClientSocket;

  constructor(socket: ClientSocket) {
    this.current = socket;
  }

  /** Id of the current socket. Changes when the connection is re-bound. */
  get id(): string {
    return this.current.id;
  }

  get transport(): string {
    return this.current.transport;
  }

  get socket(): ClientSocket {
    return this.current;
  }

  send(event: string, data?: unknown): void {
    this.current.send(event, data);
  }

  close(): void {
    this.current.close();
  }

  /** @internal Used by ConnectionManager.rebind. */
  setSocket(socket: ClientSocket): void {
    this.current = socket;
  }
}
