// Plaza (protocol v5+): chat in the room state, presence relayed to the other seat only.
// node tests/plaza.mjs (TEST_URL overrides the target).
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(15); } throw new Error('timeout: ' + label); };

function client(label) {
  const c = { label, state: null, joined: null, hello: null, errors: [], moves: [], emotes: [] };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') c.hello = m;
      if (m.type === 'state') c.state = m.room;
      if (m.type === 'joined') c.joined = m;
      if (m.type === 'error') c.errors.push(m.message);
      if (m.type === 'move') c.moves.push(m);
      if (m.type === 'emote') c.emotes.push(m);
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  return c;
}
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });

const a = client('a'); const b = client('b'); const c = client('c');
await connect(a); await connect(b); await connect(c);
await until(() => a.hello && b.hello && c.hello, 'hello');
assert.equal(a.hello.protocol, 8);

a.send({ type: 'create', name: 'Ana', bestOf: 3, avatar: 'greninja', mode: 'app' });
await until(() => a.joined && a.state, 'create');
assert.deepEqual(a.state.chat, [], 'a new room starts with an empty chat');
b.send({ type: 'join', code: a.state.code, name: 'Beto', avatar: 'lugia' });
await until(() => b.state?.players[1] && a.state.players[1], 'join');

// Presence: off-field spots are pulled back to the platform edge, facing is wrapped, and only the other seat hears it.
a.send({ type: 'move', x: 20, z: 0, face: 7 });
await until(() => b.moves.length === 1, 'move relayed');
const mv = b.moves[0];
assert.equal(mv.seat, 0);
assert.equal(mv.x, 9); assert.equal(mv.z, 0);
assert.ok(Math.abs(mv.face - (7 - 2 * Math.PI)) < 1e-3, 'facing wraps to -pi..pi');
b.send({ type: 'emote', emote: 'greet' });
await until(() => a.emotes.length === 1, 'emote relayed');
assert.deepEqual(a.emotes[0], { type: 'emote', seat: 1, emote: 'greet' });
b.send({ type: 'emote', emote: 'faceplant' });
await until(() => b.errors.includes('Malformed message'), 'unknown emote rejected');
await wait(150);
assert.equal(a.moves.length, 0, 'a player never hears their own presence');
assert.equal(a.emotes.length, 1);

// Chat lives in the room state: cleaned, numbered, seen by both seats.
a.send({ type: 'chat', text: '  hola\u0000   mundo \u202e ' });
await until(() => a.state.chat.length === 1 && b.state.chat.length === 1, 'chat');
assert.deepEqual(b.state.chat[0], { id: 1, seat: 0, text: 'hola mundo' });
b.send({ type: 'chat', text: 'x'.repeat(300) });
await until(() => a.state.chat.length === 2, 'long chat');
assert.equal(a.state.chat[1].text.length, 140, 'lines are clamped to 140 characters');
b.send({ type: 'chat', text: '   ' });
await until(() => b.errors.filter(e => e === 'Malformed message').length === 2, 'blank chat rejected');

// Flood: four lines in a burst, then one a second.
for (let i = 0; i < 6; i++) a.send({ type: 'chat', text: `line ${i}` });
await until(() => a.errors.some(e => e.startsWith('Slow down')), 'chat rate limit');
await wait(150);
const flood = a.state.chat.filter(l => l.text.startsWith('line '));
assert.ok(flood.length >= 3 && flood.length <= 4, `only the burst gets through (got ${flood.length})`);
assert.deepEqual(a.state.chat.map(l => l.id), a.state.chat.map((_, i) => i + 1), 'ids count up by one');

// Not seated: presence and chat are refused.
c.send({ type: 'move', x: 0, z: 0, face: 0 });
c.send({ type: 'chat', text: 'hi' });
await until(() => c.errors.filter(e => e === 'Not seated').length === 2, 'unseated refused');

for (const x of [a, b, c]) x.ws.close();
console.log('PLAZA_OK', { code: a.state.code, chat: a.state.chat.length, move: mv });
process.exit(0);
