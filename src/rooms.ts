import type { Connection } from './connection';

/** Named groups of connections, independent of the transport. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Set<Connection<any>>>();

  join(room: string, conn: Connection<any>): void {
    let members = this.rooms.get(room);
    if (!members) {
      members = new Set();
      this.rooms.set(room, members);
    }
    members.add(conn);
    conn.rooms.add(room);
  }

  leave(room: string, conn: Connection<any>): void {
    const members = this.rooms.get(room);
    members?.delete(conn);
    if (members?.size === 0) this.rooms.delete(room);
    conn.rooms.delete(room);
  }

  leaveAll(conn: Connection<any>): void {
    for (const room of [...conn.rooms]) this.leave(room, conn);
  }

  members(room: string): Connection<any>[] {
    return [...(this.rooms.get(room) ?? [])];
  }

  broadcast(room: string, event: string, data?: unknown, except?: Connection<any>): void {
    for (const conn of this.rooms.get(room) ?? []) {
      if (conn !== except) conn.send(event, data);
    }
  }

  delete(room: string): void {
    for (const conn of this.rooms.get(room) ?? []) conn.rooms.delete(room);
    this.rooms.delete(room);
  }
}
