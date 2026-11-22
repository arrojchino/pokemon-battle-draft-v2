import { WebSocket } from 'ws';
import { MAX_HUB, cleanSpot, type CharacterId, type HubLine, type HubMember, type PlazaEmote, type ServerMessage, type Spot } from '../../shared/src/index.js';

/** Lines a trainer walking in can still read. */
const KEEP_LINES = 40;

/**
 * The main plaza: one space shared by every trainer who walks in from the menus. The server keeps who is
 * there, where each partner last stood and the recent lines, so someone arriving sees the plaza as it is;
 * moves and emotes go on to everyone else there as they come. Nothing outlives the process.
 */
export class Hub {
  private members = new Map<WebSocket, HubMember>();
  private chat: HubLine[] = [];
  private nextMember = 0;
  private nextLine = 0;

  constructor(private send: (ws: WebSocket, msg: ServerMessage) => void) {}

  get size() { return this.members.size; }
  has(ws: WebSocket) { return this.members.has(ws); }

  /** Walk in at `at` (or a spot near the middle), or change name and partner once in. False when the plaza is full. */
  enter(ws: WebSocket, name: string, avatar: CharacterId | null, at: Spot | null): boolean {
    const cur = this.members.get(ws);
    if (cur) {
      if (cur.name !== name || cur.avatar !== avatar) { cur.name = name; cur.avatar = avatar; this.others(ws, { type: 'hubJoin', member: { ...cur } }); }
      return true;
    }
    if (this.members.size >= MAX_HUB) return false;
    let spot = at;
    if (!spot) {
      const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 2;
      spot = cleanSpot(Math.sin(a) * r, Math.cos(a) * r, a + Math.PI);
    }
    const member: HubMember = { id: `m${++this.nextMember}`, name, avatar, ...spot };
    this.members.set(ws, member);
    this.send(ws, { type: 'hub', you: member.id, members: [...this.members.values()].map(m => ({ ...m })), chat: this.chat.slice() });
    this.others(ws, { type: 'hubJoin', member: { ...member } });
    return true;
  }

  leave(ws: WebSocket) {
    const m = this.members.get(ws);
    if (!m) return;
    this.members.delete(ws);
    this.others(ws, { type: 'hubLeave', id: m.id });
  }

  move(ws: WebSocket, s: Spot) {
    const m = this.members.get(ws);
    if (!m) return;
    m.x = s.x; m.z = s.z; m.face = s.face;
    this.others(ws, { type: 'hubMove', id: m.id, x: s.x, z: s.z, face: s.face });
  }

  emote(ws: WebSocket, emote: PlazaEmote) {
    const m = this.members.get(ws);
    if (m) this.others(ws, { type: 'hubEmote', id: m.id, emote });
  }

  /** A line from a member, for everyone there (the speaker included: it comes back with its number). */
  say(ws: WebSocket, text: string): boolean {
    const m = this.members.get(ws);
    if (!m) return false;
    const line: HubLine = { id: ++this.nextLine, from: m.id, name: m.name, text };
    this.chat.push(line);
    if (this.chat.length > KEEP_LINES) this.chat.shift();
    const payload = JSON.stringify({ type: 'hubChat', line } satisfies ServerMessage);
    for (const w of this.members.keys()) if (w.readyState === WebSocket.OPEN) w.send(payload);
    return true;
  }

  /** A message for everyone in the plaza. */
  all(msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const w of this.members.keys()) if (w.readyState === WebSocket.OPEN) w.send(payload);
  }

  private others(from: WebSocket, msg: ServerMessage) {
    const payload = JSON.stringify(msg);
    for (const w of this.members.keys()) if (w !== from && w.readyState === WebSocket.OPEN) w.send(payload);
  }
}
