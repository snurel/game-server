import type { Connection } from './connection';
import type { GameServer } from './server';

export interface CommandContext<TData = unknown> {
  server: GameServer<any, TData>;
  connection: Connection<TData>;
  event: string;
}

/**
 * Handles one client event. `parse` validates the raw payload and returns it
 * typed; throw to reject it. Plug in any
 * validator, e.g. `parse: (raw) => schema.parse(raw)` with zod.
 */
export interface Command<TPayload = unknown, TData = unknown> {
  parse?(raw: unknown): TPayload;
  handle(context: CommandContext<TData>, payload: TPayload): void | Promise<void>;
}

/** Class form of Command, for apps that prefer one class per command. */
export abstract class BaseCommand<TPayload = unknown, TData = unknown> implements Command<TPayload, TData> {
  parse?(raw: unknown): TPayload;
  abstract handle(context: CommandContext<TData>, payload: TPayload): void | Promise<void>;
}

/** Thrown by `parse` to reject a payload with a client-visible message. */
export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayloadError';
  }
}
