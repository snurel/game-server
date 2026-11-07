import { Connection } from './connection';
import type { ClientSocket } from './transport/types';

/** Tracks live connections by socket id and by app identifier. */
export class ConnectionManager<TData = unknown> {
  private readonly bySocket = new Map<string, Connection<TData>>();
  private readonly byIdentifier = new Map<string, Connection<TData>>();

  add(socket: ClientSocket): Connection<TData> {
    const conn = new Connection<TData>(socket);
    this.bySocket.set(socket.id, conn);
    return conn;
  }

  get(socketId: string): Connection<TData> | undefined {
    return this.bySocket.get(socketId);
  }

  getByIdentifier(identifier: string): Connection<TData> | undefined {
    return this.byIdentifier.get(identifier);
  }

  /**
   * Associates a connection with an identifier. If another live connection
   * already had it (same device opened twice), that one is returned so the app
   * can decide; it is not closed here.
   */
  identify(conn: Connection<TData>, identifier: string): Connection<TData> | undefined {
    const previous = this.byIdentifier.get(identifier);
    if (conn.identifier && conn.identifier !== identifier) this.byIdentifier.delete(conn.identifier);
    conn.identifier = identifier;
    this.byIdentifier.set(identifier, conn);
    return previous && previous !== conn ? previous : undefined;
  }

  /**
   * Moves an existing Connection (rooms, data) onto a new socket and drops the
   * temporary Connection created for that socket. Returns the surviving one.
   */
  rebind(existing: Connection<TData>, fresh: Connection<TData>): Connection<TData> {
    if (existing === fresh) return existing;
    this.bySocket.delete(existing.id);
    this.bySocket.delete(fresh.id);
    existing.setSocket(fresh.socket);
    this.bySocket.set(existing.id, existing);
    return existing;
  }

  remove(conn: Connection<TData>): void {
    if (this.bySocket.get(conn.id) === conn) this.bySocket.delete(conn.id);
    if (conn.identifier && this.byIdentifier.get(conn.identifier) === conn) {
      this.byIdentifier.delete(conn.identifier);
    }
  }

  all(): IterableIterator<Connection<TData>> {
    return this.bySocket.values();
  }

  get size(): number {
    return this.bySocket.size;
  }
}
