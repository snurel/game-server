# @sametnurel/socket-io-game-server

A small, transport-agnostic server for turn-based multiplayer games. It gives you
commands, rooms, reconnectable sessions, matchmaking and turn timers, and lets
clients connect over **Socket.IO**, **plain WebSocket** (any engine, e.g. Godot),
or **in-process** (bots and tests) at the same time.

Game rules stay in your code. The server routes messages and manages people.

## Install

```bash
npm install @sametnurel/socket-io-game-server
# plus the transports you use:
npm install ws          # plain WebSocket
npm install socket.io   # Socket.IO
```

Requires Node 18+. Works from both CommonJS and ESM.

## Quick start

```ts
import { GameServer, PayloadError } from '@sametnurel/socket-io-game-server';
import { WebSocketTransport } from '@sametnurel/socket-io-game-server/ws';
import { SocketIOTransport } from '@sametnurel/socket-io-game-server/socket-io';

const server = new GameServer({
  transports: [new WebSocketTransport({ path: '/ws' }), new SocketIOTransport()],
  port: 5200,
  cors: { origin: ['https://my-game.example'] },
});

server.command<{ text: string }>('chat', {
  parse(raw) {
    const text = (raw as { text?: unknown } | null)?.text;
    if (typeof text !== 'string' || text.length > 200) throw new PayloadError('text must be a short string');
    return { text };
  },
  handle({ server, connection }, { text }) {
    server.broadcast('lobby', 'chat', { from: connection.id, text });
  },
});

server.onConnect((connection) => server.rooms.join('lobby', connection));

await server.start();
```

Nothing is global: create as many servers as you like (handy in tests).

## Transports

| Transport | Import | Wire format |
| --- | --- | --- |
| `WebSocketTransport` | `.../ws` | One JSON frame per message: `{ "event": string, "data"?: any }`, both directions |
| `SocketIOTransport` | `.../socket-io` | Socket.IO events: `emit(event, data)` |
| `MemoryTransport` | built in | `server.createVirtualClient()`: for bots and tests |

All transports share one HTTP server, rooms and commands; a room can mix clients
from different transports. Plain WebSocket clients get a ping every 30 s and are
dropped if they stop answering.

### Bring your own HTTP server

Pass an existing server (e.g. Express) to serve a REST API on the same port:

```ts
const app = express();
app.get('/health', (_req, res) => res.send('ok'));
const http = app.listen(5200);
const server = new GameServer({ httpServer: http, transports: [new WebSocketTransport()] });
await server.start();
```

## Commands

`server.command(event, commandOrFunction)` registers one handler per event.

- `parse(raw)` validates the payload and returns it typed. Throw to reject; the
  client gets `error` `{ code: 'invalid_payload', event, message }` (message only
  for `PayloadError`). Any validator works: `parse: (raw) => schema.parse(raw)`.
- `handle(context, payload)` runs the logic. `context` has `server`, `connection`, `event`.
- A throwing or rejecting handler never crashes the process: it is logged and the
  client gets `{ code: 'internal_error', event }`.
- Unregistered events get `{ code: 'unknown_event', event }`.
- Messages from one client are handled **in order**, also when handlers are async.

Prefer classes? Extend `BaseCommand<TPayload>`.

## Connections and rooms

`Connection` wraps the current socket and has `data` (your state), `identifier`
(a stable device or account id) and `rooms`. Use `connections.identify(conn, id)`
and `connections.rebind(existing, fresh)` to move a returning client onto its
new socket while keeping rooms and data.

`server.rooms.join/leave/leaveAll/members`, `server.broadcast(room, event, data, except?)`.
Disconnected clients leave all rooms automatically, then `onDisconnect` hooks run.

## Games

```ts
class Match extends Game<'SETUP' | 'PLAY'> {
  start() { this.status = 'PLAY'; }
  override update(tick: number, now: number) { /* called every tickIntervalMs */ }
  override dispose() { /* clear timers */ }
}
const match = server.games.create((id) => new Match(id));
server.broadcast(match.roomId, 'started');
server.games.remove(match.id); // disposes and frees the id
```

Game ids come from `IdGenerator` (default 1000-9999). Ids are freed on remove and
the generator throws when the range is full instead of hanging.

## Sessions and reconnect

```ts
const sessions = new SessionManager<{ gameId: number }>({
  reconnectWindowMs: 30_000,
  onExpire: (session) => forfeit(session.state?.gameId),
});

server.command<{ deviceId: string }>('hello', ({ connection }, { deviceId }) => {
  const { session, resumed } = sessions.attach(deviceId, connection);
  connection.identifier = deviceId;
  if (resumed) connection.send('resume', session.state);
});
server.onDisconnect((connection) => sessions.detach(connection));
```

## Matchmaking, bots and turn timers

```ts
const queue = new MatchQueue<Player>((p) => p.id); // groups of 2
const pair = queue.enqueue('ranked', player);        // Player[] when a match forms
const lonely = queue.takeWaitingLongerThan('ranked', 15_000); // pair these with bots

const bot = server.createVirtualClient(); // a bot speaks the same protocol
bot.on('yourTurn', (state) => bot.send('move', decide(state)));

const timer = new TurnTimer();
timer.start(30_000, () => endTurn());
connection.send('turn', { deadline: timer.deadline });
```

## Logging

`ConsoleLogger` (level from `LOG_LEVEL`, default `info`) is used by default.
Pass `logger: silentLogger` or your own `{ error, warn, info, debug }`.

## Migrating from 0.0.x

1.0 is a rewrite; see [CHANGELOG.md](CHANGELOG.md). In short: no singletons
(`GameManager.getInstance()` → `server.games`), commands receive a context
instead of a socket, transports are pluggable, and port/CORS are options.

## License

ISC © Samet Nurel
