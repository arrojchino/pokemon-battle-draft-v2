import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, createRoom, parseClientMessage, publicView, reduce, seatForToken, seatGuest,
  type Pair, type RoomState, type Rng, type Seat, type ServerMessage,
} from '../../shared/src/index.js';

/**
 * Authoritative room server. All game rules live in shared/src/room.ts (`reduce`), the same code the
 * PeerJS host runs, so the two transports cannot diverge. This file only owns identity, sockets,
 * rate limiting and expiry.
 */

const PORT = Number(process.env.PORT || 8787);
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const TTL_MS = Number(process.env.ROOM_TTL_MINUTES || 45) * 60_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 5000);
const MSG_PER_SEC = 20;
const CREATES_PER_MIN = 10;

type Room = { state: RoomState; updatedAt: number };
type Meta = { room: string; seat: Seat };
const rooms = new Map<string, Room>();
const sockets = new Map<WebSocket, Meta | null>();
const alive = new WeakSet<WebSocket>();

const rng: Rng = {
  coin: () => ((randomBytes(1)[0] & 1) === 0 ? 'heads' : 'tails'),
  float: () => randomBytes(4).readUInt32BE(0) / 0x100000000,
};

function newCode(): string {
  for (let i = 0; i < 20; i++) { const c = randomBytes(3).toString('hex').toUpperCase(); if (!rooms.has(c)) return c; }
  throw new Error('code space exhausted');
}
function send(ws: WebSocket, msg: ServerMessage) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
function connectedSeats(code: string): Pair<boolean> {
  const c: Pair<boolean> = [false, false];
  for (const [ws, meta] of sockets) if (meta && meta.room === code && ws.readyState === WebSocket.OPEN) c[meta.seat] = true;
  return c;
}
function broadcast(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  const payload = JSON.stringify({ type: 'state', room: publicView(room.state, connectedSeats(code), PROTOCOL_VERSION) } satisfies ServerMessage);
  for (const [ws, meta] of sockets) if (meta && meta.room === code && ws.readyState === WebSocket.OPEN) ws.send(payload);
}
function seat(ws: WebSocket, code: string, s: Seat) {
  const prev = sockets.get(ws);
  sockets.set(ws, { room: code, seat: s });
  if (prev && prev.room !== code) broadcast(prev.room);
}

/** Token buckets keyed by socket (messages) and by client address (room creation). */
const buckets = new Map<string, { tokens: number; at: number }>();
function take(key: string, ratePerSec: number, burst: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * ratePerSec); b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1; buckets.set(key, b); return true;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, protocol: PROTOCOL_VERSION }));
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 4096 });

let socketSeq = 0;
wss.on('connection', (ws, req) => {
  const origin = String(req.headers.origin || '');
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) { ws.close(1008, 'origin'); return; }
  const id = `s${++socketSeq}`;
  const addr = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  sockets.set(ws, null); alive.add(ws);
  ws.on('pong', () => alive.add(ws));
  send(ws, { type: 'hello', protocol: PROTOCOL_VERSION });

  ws.on('message', raw => {
    if (!take(id, MSG_PER_SEC, MSG_PER_SEC * 2)) { send(ws, { type: 'error', message: 'Slow down' }); return; }
    const msg = parseClientMessage(String(raw));
    if (!msg) { send(ws, { type: 'error', message: 'Malformed message' }); return; }
    const meta = sockets.get(ws) ?? null;

    if (msg.type === 'create') {
      if (!take(`create:${addr}`, CREATES_PER_MIN / 60, CREATES_PER_MIN)) { send(ws, { type: 'error', message: 'Too many rooms created, wait a minute' }); return; }
      if (rooms.size >= MAX_ROOMS) { send(ws, { type: 'error', message: 'Server is full, try again later' }); return; }
      const code = newCode();
      const token = randomUUID();
      rooms.set(code, { state: createRoom(code, { name: msg.name, token, avatar: msg.avatar }, msg.bestOf), updatedAt: Date.now() });
      seat(ws, code, 0);
      send(ws, { type: 'joined', code, token, seat: 0 });
      broadcast(code); return;
    }

    if (msg.type === 'join' || msg.type === 'resume') {
      const room = rooms.get(msg.code.toUpperCase());
      if (!room) { send(ws, { type: 'error', message: 'Unknown room' }); return; }
      if (msg.type === 'resume') {
        const s = seatForToken(room.state, msg.token);
        if (s === null) { send(ws, { type: 'error', message: 'Invalid session' }); return; }
        seat(ws, room.state.code, s);
        send(ws, { type: 'joined', code: room.state.code, token: msg.token, seat: s });
      } else {
        const token = randomUUID();
        const r = seatGuest(room.state, { name: msg.name, token, avatar: msg.avatar });
        if (!r.ok) { send(ws, { type: 'error', message: r.error }); return; }
        room.state = r.room;
        seat(ws, room.state.code, r.seat);
        send(ws, { type: 'joined', code: room.state.code, token, seat: r.seat });
      }
      room.updatedAt = Date.now();
      broadcast(room.state.code); return;
    }

    // Game actions only apply to the socket's own seated room. (v1 also accepted a `code` field here,
    // but seat ownership was always checked against the socket, so ignoring it is equivalent.)
    if (!meta) { send(ws, { type: 'error', message: 'Not seated' }); return; }
    const room = rooms.get(meta.room);
    if (!room) { send(ws, { type: 'error', message: 'Unknown room' }); return; }
    const r = reduce(room.state, meta.seat, msg, rng);
    if (!r.ok) { send(ws, { type: 'error', message: r.error }); return; }
    room.state = r.room; room.updatedAt = Date.now();
    broadcast(meta.room);
  });

  ws.on('close', () => {
    const meta = sockets.get(ws);
    sockets.delete(ws); buckets.delete(id);
    if (meta) broadcast(meta.room);
  });
});

// Heartbeat: drop dead sockets so `connected` presence stays accurate.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) { ws.terminate(); continue; }
    alive.delete(ws); ws.ping();
  }
}, 30_000);
heartbeat.unref();

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [c, room] of rooms) if (now - room.updatedAt > TTL_MS) rooms.delete(c);
  for (const [k, b] of buckets) if (now - b.at > 120_000) buckets.delete(k);
}, 60_000);
sweeper.unref();

server.listen(PORT, () => console.log(`pokemon anime battle backend listening on ${PORT} (protocol v${PROTOCOL_VERSION})`));

const shutdown = () => { wss.close(); server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
