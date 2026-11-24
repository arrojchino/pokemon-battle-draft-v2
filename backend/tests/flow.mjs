// Two real WebSocket clients against a running backend: node tests/flow.mjs (TEST_URL overrides the target).
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(15); } throw new Error('timeout: ' + label); };

function client(label) {
  const c = { label, state: null, joined: null, errors: [], hello: null, raw: [] };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const text = String(raw); c.raw.push(text);
      const m = JSON.parse(text);
      if (m.type === 'hello') c.hello = m;
      if (m.type === 'state') c.state = m.room;
      if (m.type === 'joined') c.joined = m;
      if (m.type === 'error') c.errors.push(m.message);
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  return c;
}
/** Listen before the socket opens: the server sends `hello` immediately on connection. */
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });

const a = client('a'); const b = client('b');
await connect(a); await connect(b);
await until(() => a.hello && b.hello, 'hello');
assert.equal(a.hello.protocol, 11);

// v2 create with avatar; v1-style join (no avatar field) must still work.
a.send({ type: 'create', name: 'Ana\u0000‮', bestOf: 3, avatar: 'greninja' });
await until(() => a.joined && a.state, 'create');
const code = a.state.code;
assert.match(code, /^[0-9A-F]{6}$/);
assert.equal(a.state.players[0].name, 'Ana', 'control and bidi characters are stripped');
b.send({ type: 'join', code: code.toLowerCase(), name: 'Beto' });
await until(() => b.state?.players[1] && a.state.players[1], 'join');
assert.equal(a.state.players[1].name, 'Beto');
assert.equal(a.state.players[1].avatar, null);
assert.ok(a.state.players[0].connected && a.state.players[1].connected, 'presence');

// Security: no bearer token may appear in any broadcast.
const tokens = [a.joined.token, b.joined.token];
for (const c of [a, b]) for (const text of c.raw.filter(t => t.includes('"state"'))) for (const tok of tokens) assert.ok(!text.includes(tok), `${c.label} received a token in a state broadcast`);

// Avatar selection is validated against the whitelist.
b.send({ type: 'avatar', avatar: 'fuecoco' });
await until(() => a.state.players[1].avatar === 'fuecoco', 'avatar');
// Both seats see both partners: the joiner's change reaches its own view too, and the host's stays put.
await until(() => b.state.players[1].avatar === 'fuecoco' && b.state.players[0].avatar === 'greninja', 'both views agree');
assert.equal(a.state.players[0].avatar, 'greninja', "a join never overwrites the host's partner");
b.send({ type: 'avatar', avatar: '../../etc/passwd' });
await until(() => b.errors.includes('Malformed message'), 'bad avatar rejected');

// A third client cannot take a seat.
const c = client('c'); await connect(c);
c.send({ type: 'join', code, name: 'Intruder' });
await until(() => c.errors.includes('Room is full'), 'room full');
c.send({ type: 'flip' });
await until(() => c.errors.includes('Not seated'), 'unseated action');
c.ws.close();

// One caller per coin, drawn at random for game 1; the call itself flips the coin.
await until(() => a.state.caller === 0 || a.state.caller === 1, 'caller drawn');
const callerSeat = a.state.caller;
const caller = callerSeat === 0 ? a : b; const nonCaller = callerSeat === 0 ? b : a;
nonCaller.send({ type: 'call', side: 'heads' });
await until(() => nonCaller.errors.some(e => e.endsWith('calls this coin')), 'non-caller call rejected');
b.send({ type: 'spin' });
await until(() => b.errors.includes('Not time to deal'), 'deal before the call rejected');
caller.send({ type: 'call', side: 'heads' });
await until(() => a.state.phase === 'spin' && b.state.phase === 'spin', 'call flips the coin');
a.send({ type: 'flip' });
await until(() => a.errors.includes('The coin flips as soon as it is called'), 'retired flip rejected');
const result = a.state.result;
const winner = a.state.tossWinner;
assert.equal(a.state.calls[callerSeat], 'heads'); assert.equal(a.state.calls[1 - callerSeat], 'tails');
assert.equal(result === 'heads' ? callerSeat : 1 - callerSeat, winner);
assert.equal(b.state.result, result);

b.send({ type: 'spin' });
await until(() => a.state.phase === 'pick' && b.state.phase === 'pick', 'deal');
const picker = winner === 0 ? a : b; const other = winner === 0 ? b : a;
assert.equal(other.state.candidates, null, 'only the toss winner sees the dealt teams');
const candidates = picker.state.candidates;
assert.equal(candidates.length, 2);
assert.equal(new Set([...candidates[0], ...candidates[1]].map(p => p.name)).size, 12);
assert.ok(candidates[0].every(p => Array.isArray(p.types) && p.types.length >= 1), 'types are included');
other.send({ type: 'pick', team: 0 });
await until(() => other.errors.includes('Only the toss winner picks'), 'non-winner pick rejected');
picker.send({ type: 'pick', team: 1 });
await until(() => b.state.phase === 'battle' && a.state.phase === 'battle', 'pick');
// Each player gets their own six in full and only the rival's species and types.
assert.deepEqual(picker.state.teams[winner].map(p => p.name), candidates[1].map(p => p.name));
assert.deepEqual(other.state.teams[1 - winner].map(p => p.name), candidates[0].map(p => p.name));
assert.equal(picker.state.teams[1 - winner].length, 0); assert.equal(other.state.teams[winner].length, 0);
assert.deepEqual(other.state.rival.map(p => p.name), candidates[1].map(p => p.name));
assert.ok(other.state.rival.every(p => !('moves' in p) && !('item' in p) && !('ability' in p)), 'rival sets stay hidden');

b.send({ type: 'result', winner: 1 - winner });
await until(() => a.state.phase === 'between', 'result');
assert.equal(a.state.wins[1 - winner], 1);
assert.equal(a.state.history[0].toss, result);
a.send({ type: 'next' });
await until(() => b.state.phase === 'calls' && b.state.games === 1, 'next');
assert.equal(a.state.caller, 1 - winner, 'the winner of game 1 calls game 2');

// Reconnect with the stored token (what the browser does after a refresh).
const tokenB = b.joined.token;
b.ws.close();
await until(() => a.state.players[1] && a.state.players[1].connected === false, 'presence drops');
const b2 = client('b2'); await connect(b2);
b2.send({ type: 'resume', code, token: 'not-the-token' });
await until(() => b2.errors.includes('Invalid session'), 'bad resume rejected');
b2.send({ type: 'resume', code, token: tokenB });
await until(() => b2.joined?.seat === 1 && a.state.players[1].connected, 'resume');

// Seat 0 wins until the best-of-3 completes (1 or 2 more games depending on game 1's toss).
for (let g = 0; a.state.phase !== 'complete'; g++) {
  assert.ok(g < 3, 'series should complete');
  (a.state.caller === 0 ? a : b2).send({ type: 'call', side: 'heads' });
  await until(() => a.state.phase === 'spin', 'call ' + g);
  a.send({ type: 'spin' }); await until(() => a.state.phase === 'pick', 'deal ' + g);
  (a.state.tossWinner === 0 ? a : b2).send({ type: 'pick', team: 0 });
  await until(() => a.state.phase === 'battle', 'pick ' + g);
  a.send({ type: 'result', winner: 0 });
  await until(() => a.state.games === 2 + g, 'result ' + g);
  if (a.state.phase === 'between') a.send({ type: 'next' });
  await until(() => a.state.phase === 'calls' || a.state.phase === 'complete', 'advance ' + g);
  if (a.state.phase === 'calls') assert.equal(a.state.caller, 0, 'the previous winner calls');
}
assert.equal(a.state.phase, 'complete');
assert.equal(a.state.wins[0], 2);
assert.equal(a.state.history.length, a.state.games);
a.send({ type: 'reset', bestOf: 5 });
await until(() => b2.state.phase === 'calls' && b2.state.bestOf === 5 && b2.state.games === 0, 'reset');
assert.ok(b2.state.caller === 0 || b2.state.caller === 1, 'a new series draws a caller');

console.log('FLOW_OK', { code, result, winner, protocol: a.hello.protocol });
a.ws.close(); b2.ws.close();
