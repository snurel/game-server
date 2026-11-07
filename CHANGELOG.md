# Changelog

## 1.0.2

### Fixed
- Disconnected virtual clients stayed in memory; they are now released.

### Added
- `createVirtualClient({ record: false })` for long-lived clients such as bots, so received messages are not kept.
- `server.virtualClients` count.

## 1.0.1

### Fixed
- Virtual (memory) clients lost messages that the server sent right before closing the connection.

## 1.0.0

First stable release, renamed from `@sametnurel/socket-io-game-server` (0.0.x) because the server is no longer tied to Socket.IO. A rewrite with breaking changes.

### Added
- Pluggable transports: `SocketIOTransport`, `WebSocketTransport` (plain JSON frames, for engines without Socket.IO such as Godot) and an in-process `MemoryTransport`. Several can run on one HTTP server and share rooms.
- `GameServer` instance that wires everything; several servers per process are possible.
- Payload validation per command (`parse`), `PayloadError`, and `error` events with codes (`unknown_event`, `invalid_payload`, `internal_error`, `bad_frame`).
- Per-client in-order message handling, also for async commands.
- `SessionManager` (reconnect window), `MatchQueue` (matchmaking per mode, stale-entry pickup for bots), `TurnTimer`, `RoomRegistry`.
- `Game<TStatus>` with custom phases, `update(tick, now)` on a server tick, `dispose()`.
- `createVirtualClient()` for bots and tests.
- Options for port, host, CORS, an existing HTTP server, logger and tick interval.
- Test suite (Vitest).

### Changed
- No singletons: use `server.games`, `server.connections`, `server.rooms`.
- Commands get `(context, payload)` instead of `(socket, connection, message)`.
- Event names are plain strings; system events live in `SystemEvents`.
- `socket.io` and `ws` are optional peer dependencies; Express is no longer required.

### Fixed
- `IdGenerator` looped forever once 9000 ids were used; ids are now released and exhaustion throws.
- The logger, `GameOverParams` and other public types were not exported.
- A throwing command could crash the process.
- Removed use of Socket.IO's private `_readyState`.
- README: wrong package name, placeholder badges, license mismatch.
