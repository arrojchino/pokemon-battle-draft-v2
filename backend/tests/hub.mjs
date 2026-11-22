// Main plaza and spectators (protocol v6): presence and chat for everyone in the plaza, a public battle
// followed without a seat, the live list. node tests/hub.mjs (TEST_URL overrides the target).
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(15); } throw new Error('timeout: ' + label); };

function client(label) {
  const c = { label, hello: null, hub: null, joins: [], leaves: [], moves: [], emotes: [], lines: [], errors: [], state: null, joined: null, watching: undefined, battle: { id: 0, lines: [] }, lobbies: null, request: null };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') c.hello = m;
      else if (m.type === 'hub') c.hub = m;
      else if (m.type === 'hubJoin') c.joins.push(m.member);
      else if (m.type === 'hubLeave') c.leaves.push(m.id);
      else if (m.type === 'hubMove') c.moves.push(m);
      else if (m.type === 'hubEmote') c.emotes.push(m);
      else if (m.type === 'hubChat') c.lines.push(m.line);
      else if (m.type === 'error') c.errors.push(m.message);
      else if (m.type === 'state') c.state = m.room;
      else if (m.type === 'joined') c.joined = m;
      else if (m.type === 'watching') c.watching = m.code;
      else if (m.type === 'lobbies') c.lobbies = m;
      else if (m.type === 'battle') {
        if (m.reset || m.id !== c.battle.id) c.battle = { id: m.id, lines: [] };
        c.battle.lines.push(...m.lines);
        for (const l of m.lines) if (l.startsWith('|request|')) c.request = JSON.parse(l.slice(9));
      }
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  return c;
}
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });

const a = client('a'), b = client('b'), c = client('c');
await connect(a); await connect(b); await connect(c);
await until(() => a.hello && b.hello && c.hello, 'hello');
assert.equal(a.hello.protocol, 6);

// ---- The main plaza
a.send({ type: 'hub', on: true, name: 'Ana', avatar: 'greninja', at: { x: 1, z: 2, face: 0.5 } });
await until(() => a.hub, 'a enters');
// Others may already be here (a shared or live server): everything below is relative to them.
const base = a.hub.members.length;
const ana = a.hub.members.find(m => m.id === a.hub.you);
assert.ok(ana, 'the snapshot includes the newcomer');
assert.deepEqual([ana.x, ana.z, ana.face], [1, 2, 0.5], 'a trainer appears where their client put them');
b.send({ type: 'hub', on: true, name: 'Beto\u202e', avatar: 'lugia', at: null });
await until(() => b.hub && a.joins.some(m => m.id === b.hub.you), 'b enters, a hears it');
assert.equal(b.hub.members.length, base + 1, 'a newcomer sees everyone');
const bj = a.joins.find(m => m.id === b.hub.you);
assert.equal(bj.name, 'Beto', 'names are cleaned');
assert.ok(Math.hypot(bj.x, bj.z) <= 9, 'the server spawn is on the platform');
const beto = b.hub.you;
const from = (list, id) => list.filter(m => m.id === id);

// Moves and emotes reach everyone else, pulled back onto the platform; never the sender.
b.send({ type: 'hubMove', x: 30, z: 0, face: 0 });
await until(() => from(a.moves, beto).length === 1, 'move relayed');
assert.deepEqual(from(a.moves, beto)[0], { type: 'hubMove', id: beto, x: 9, z: 0, face: 0 });
a.send({ type: 'hubEmote', emote: 'twirl' });
await until(() => from(b.emotes, a.hub.you).length === 1, 'emote relayed');
assert.deepEqual(from(b.emotes, a.hub.you)[0], { type: 'hubEmote', id: a.hub.you, emote: 'twirl' });
await wait(120);
assert.equal(from(b.moves, beto).length, 0, 'nobody hears their own moves');

// Chat: cleaned, numbered, for everyone there (the speaker too); a newcomer reads the recent lines.
a.send({ type: 'hubChat', text: '  hola\u0000  plaza ' });
const said = list => list.filter(l => l.from === a.hub.you);
await until(() => said(a.lines).length === 1 && said(b.lines).length === 1, 'chat');
const { id: lineId, ...line } = said(b.lines)[0];
assert.deepEqual(line, { from: a.hub.you, name: 'Ana', text: 'hola plaza' });
assert.ok(Number.isInteger(lineId) && lineId > 0, 'lines are numbered');
c.send({ type: 'hubChat', text: 'hi' });
await until(() => c.errors.includes('Not in the plaza'), 'outsiders cannot talk');
c.send({ type: 'hub', on: true, name: 'Cami', avatar: 'fuecoco', at: null });
await until(() => c.hub, 'c enters');
assert.equal(c.hub.members.length, base + 2);
assert.deepEqual(c.hub.chat.at(-1), { id: lineId, from: a.hub.you, name: 'Ana', text: 'hola plaza' }, 'recent lines for newcomers');
for (let i = 0; i < 6; i++) c.send({ type: 'hubChat', text: `spam ${i}` });
await until(() => c.errors.some(e => e.startsWith('Slow down')), 'chat rate limit');
// Changing name keeps the id; everyone else hears it.
c.send({ type: 'hub', on: true, name: 'Camila', avatar: 'fuecoco', at: null });
await until(() => a.joins.some(m => m.name === 'Camila' && m.id === c.hub.you), 'rename');
// Leaving: everyone else hears it, and moves from outside go nowhere.
b.send({ type: 'hub', on: false });
await until(() => a.leaves.includes(beto) && c.leaves.includes(beto), 'leave');
b.send({ type: 'hubMove', x: 0, z: 0, face: 0 });
await wait(120);
assert.equal(from(a.moves, beto).length, 1);

// ---- Spectators: Beto and Ana battle in a public room; Cami watches.
b.send({ type: 'create', name: 'Beto', bestOf: 3, avatar: 'lugia', mode: 'app', visibility: 'public' });
await until(() => b.state && b.joined, 'create');
const code = b.state.code;
a.send({ type: 'join', code, name: 'Ana', avatar: 'greninja' });
await until(() => a.state?.code === code && b.state.players[1], 'join');
await until(() => c.leaves.includes(a.hub.you), 'taking a seat leaves the plaza');
a.send({ type: 'hub', on: true, name: 'Ana', avatar: 'greninja', at: null });
await until(() => a.errors.includes('Leave your room to enter the plaza'), 'seated trainers stay out of the plaza');

const watch = c.watching;
c.send({ type: 'watch', code: 'ZZZZZZ' });
await until(() => c.errors.includes('That room is gone'), 'unknown room');
assert.equal(c.watching, watch);
c.send({ type: 'watch', code: code.toLowerCase() });
await until(() => c.watching === code && c.state?.code === code, 'watching');
await until(() => b.state.watchers === 1 && a.state.watchers === 1 && c.state.watchers === 1, 'everyone sees the spectator count');

await until(() => b.state.caller === 0 || b.state.caller === 1, 'caller drawn');
(b.state.caller === 0 ? b : a).send({ type: 'call', side: 'heads' });
await until(() => b.state.phase === 'spin', 'call');
assert.equal(c.state.phase, 'spin');
b.send({ type: 'spin' });
await until(() => b.state.phase === 'pick' && c.state.phase === 'pick', 'deal');
assert.equal(c.state.candidates, null, 'spectators never see the dealt teams');
(b.state.tossWinner === 0 ? b : a).send({ type: 'pick', team: 0 });
await until(() => c.state.phase === 'battle' && c.state.battle, 'battle starts');
assert.deepEqual(c.state.teams, [[], []], 'no sets for spectators');
assert.equal(c.state.rival, null);
await until(() => c.battle.lines.some(l => l.startsWith('|poke|')), 'team preview reaches the spectator');
await until(() => a.request && b.request, 'requests');
a.send({ type: 'choose', choice: 'team 123456' }); b.send({ type: 'choose', choice: 'team 123456' });
await until(() => c.battle.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'switch-ins');
const switches = c.battle.lines.filter(l => l.startsWith('|switch|'));
assert.ok(switches.every(l => /\|\d+\/100( |$)/.test(l)), 'spectators see HP as percentages: ' + switches.join(' '));
assert.ok(!c.battle.lines.some(l => l.startsWith('|request|')), 'spectators never get a request');
assert.equal(c.battle.id, c.state.battle.id);

// The live list, and a late spectator who gets the public stream so far in one go.
const d = client('d');
await connect(d);
d.send({ type: 'lobbies' });
await until(() => d.lobbies, 'lobbies');
const live = d.lobbies.live.find(l => l.code === code);
assert.ok(live, 'the battle is listed as live');
assert.deepEqual(live.names, ['Beto', 'Ana']);
assert.deepEqual(live.avatars, ['lugia', 'greninja']);
assert.equal(live.watchers, 1);
d.send({ type: 'watch', code });
await until(() => d.battle.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'late spectator replay');
await until(() => b.state.watchers === 2, 'two watching');
d.send({ type: 'choose', choice: 'move 1' });
await until(() => d.errors.includes('Not seated'), 'spectators cannot play');
d.send({ type: 'unwatch' });
await until(() => d.watching === null && b.state.watchers === 1, 'unwatch');
c.ws.close();
await until(() => b.state.watchers === 0 && a.state.watchers === 0, 'closing stops watching');

for (const x of [a, b, d]) x.ws.close();
console.log('HUB_OK', { code, members: 3, switches: switches.length, live });
process.exit(0);
