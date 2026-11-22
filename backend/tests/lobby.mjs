// Public lobbies against a running backend (expects no other open public lobbies): node tests/lobby.mjs
// TEST_URL overrides the target.
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(15); } throw new Error('timeout: ' + label); };

function client(label) {
  const c = { label, state: null, joined: null, errors: [], hello: null, lobbies: null };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'hello') c.hello = m;
      if (m.type === 'state') c.state = m.room;
      if (m.type === 'joined') c.joined = m;
      if (m.type === 'error') c.errors.push(m.message);
      if (m.type === 'lobbies') c.lobbies = m;
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  return c;
}
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });
const list = async c => { c.lobbies = null; c.send({ type: 'lobbies' }); await until(() => c.lobbies, 'list ' + c.label); return c.lobbies; };
/** Re-list until `pred` holds: presence changes reach the server asynchronously. */
const listUntil = async (c, pred, label) => { const t = Date.now(); while (Date.now() - t < 4000) { const l = await list(c); if (pred(l)) return l; await wait(40); } throw new Error('timeout: ' + label); };
const listed = (l, code) => l.lobbies.some(x => x.code === code);

const [ana, beto, cleo, dani, eve, fox, gus] = ['ana', 'beto', 'cleo', 'dani', 'eve', 'fox', 'gus'].map(client);
for (const c of [ana, beto, cleo, dani, eve, fox, gus]) await connect(c);
await until(() => ana.hello, 'hello');
assert.equal(ana.hello.protocol, 8);

// A v3-style create (no visibility) is private and never listed.
ana.send({ type: 'create', name: 'Ana', bestOf: 3, avatar: 'greninja', mode: 'app' });
await until(() => ana.state, 'create private');
assert.equal(ana.state.visibility, 'private');
assert.ok(!listed(await list(eve), ana.state.code), 'private rooms are not listed');

// Public rooms are listed, longest-waiting first, with host, partner, series and battle mode.
beto.send({ type: 'create', name: 'Beto', bestOf: 5, avatar: 'lugia', mode: 'app', visibility: 'public' });
await until(() => beto.state, 'create public');
await wait(5);
cleo.send({ type: 'create', name: 'Cleo', bestOf: 3, avatar: 'fuecoco', mode: 'showdown', visibility: 'public' });
await until(() => cleo.state, 'create public 2');
assert.equal(beto.state.visibility, 'public');
let l = await list(eve);
const entry = l.lobbies.find(x => x.code === beto.state.code);
assert.ok(entry, 'public room is listed');
assert.deepEqual({ ...entry, createdAt: 0 }, { code: beto.state.code, host: 'Beto', avatar: 'lugia', bestOf: 5, mode: 'app', createdAt: 0, players: 1 });
assert.ok(l.now >= entry.createdAt && l.now - entry.createdAt < 10_000, 'createdAt is on the server clock');
const codes = l.lobbies.map(x => x.code);
assert.ok(codes.indexOf(beto.state.code) < codes.indexOf(cleo.state.code), 'oldest first');
assert.ok(!JSON.stringify(l).includes(beto.joined.token), 'listing carries no tokens');

// A host who goes away drops off the list; resuming the seat lists the room again.
const cleoCode = cleo.state.code, cleoToken = cleo.joined.token;
cleo.ws.close();
await listUntil(eve, x => !listed(x, cleoCode), 'absent host unlisted');
const cleo2 = client('cleo2'); await connect(cleo2);
cleo2.send({ type: 'resume', code: cleoCode, token: cleoToken });
await until(() => cleo2.joined, 'resume');
await listUntil(eve, x => listed(x, cleoCode), 'returning host listed');

// Quick join takes the longest-waiting open lobby, and a full room leaves the list.
const oldest = (await list(eve)).lobbies[0];
assert.equal(oldest.code, beto.state.code, 'Beto has waited longest (run against a server with no other public lobbies)');
dani.send({ type: 'quick', name: 'Dani', avatar: 'dragonite', bestOf: 3, mode: 'showdown' });
await until(() => dani.joined && dani.state, 'quick join');
assert.equal(dani.state.code, beto.state.code);
assert.equal(dani.joined.seat, 1);
await until(() => beto.state.players[1]?.name === 'Dani', 'host sees the guest');
assert.equal(beto.state.players[1].avatar, 'dragonite');
assert.ok(!listed(await list(eve), beto.state.code), 'full rooms are not listed');

eve.send({ type: 'quick', name: 'Eve', avatar: null, bestOf: 5, mode: 'app' });
await until(() => eve.joined, 'quick join 2');
assert.equal(eve.state.code, cleoCode);

// With nothing open, quick join opens a public lobby with the requested settings; seat names fill in blanks.
fox.send({ type: 'quick', name: '', avatar: 'marill', bestOf: 5, mode: 'app' });
await until(() => fox.joined && fox.state, 'quick create');
assert.equal(fox.joined.seat, 0);
assert.deepEqual([fox.state.visibility, fox.state.bestOf, fox.state.mode, fox.state.players[0].name], ['public', 5, 'app', 'Player 1']);
assert.ok(listed(await list(gus), fox.state.code), 'quick-created lobby is listed');
gus.send({ type: 'quick', avatar: 'gimmighoul' });
await until(() => gus.joined, 'quick join 3');
assert.equal(gus.state.code, fox.state.code);
assert.equal(gus.state.players[1].name, 'Player 2');
for (const c of [ana, beto, dani, eve, fox, gus]) assert.deepEqual(c.errors, [], `${c.label} saw no errors`);

console.log('LOBBY_OK', { private: ana.state.code, quickJoined: beto.state.code, quickCreated: fox.state.code, protocol: ana.hello.protocol });
for (const c of [ana, beto, cleo2, dani, eve, fox, gus]) c.ws.close();
process.exit(0);
