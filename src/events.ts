/** Events the server itself sends. Game events are plain strings chosen by the app. */
export const SystemEvents = {
  /** Sent when a message is rejected or a handler fails. Payload: ErrorPayload. */
  Error: 'error',
} as const;

export type SystemEvent = (typeof SystemEvents)[keyof typeof SystemEvents];

export const ErrorCodes = {
  UnknownEvent: 'unknown_event',
  InvalidPayload: 'invalid_payload',
  InternalError: 'internal_error',
  BadFrame: 'bad_frame',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorPayload {
  code: ErrorCode;
  /** The client event that caused the error, when known. */
  event?: string;
  message?: string;
}
