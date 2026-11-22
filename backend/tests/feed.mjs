// The plaza feed (protocol v8): the server features one live public battle for the main plaza and streams its
// public lines to plaza members who opt in, without taking them out of the plaza or counting them as watchers.
// node tests/feed.mjs (TEST_URL overrides the target; needs a server with no other live public battles).
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(15); } throw new Error('timeout: ' + label); };

function client(label) {
  const c = { label, hello: null, hub: null, errors: [], state: null, joined: null, battle: { id: 0, lines: [] }, request: null, features: [], feed: { code: null, id: 0, lines: [], resets: 0 }, lines: [], types: new Set() };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      c.types.add(m.type);
      if (m.type === 'hello') c.hello = m;
      else if (m.type === 'hub') c.hub = m;
      else if (m.type === 'hubChat') c.lines.push(m.line);
      else if (m.type === 'error') c.errors.push(m.message);
      else if (m.type === 'state') c.state = m.room;
      else if (m.type === 'joined') c.joined = m;
      else if (m.type === 'hubFeature') c.features.push(m.feature);
      else if (m.type === 'hubFeed') {
        if (m.reset) { c.feed = { code: m.code, id: m.id, lines: [], resets: c.feed.resets + 1 }; }
        assert.equal(m.code, c.feed.code, 'feed lines belong to the battle that was reset');
        c.feed.lines.push(...m.lines);
      } else if (m.type === 'battle') {
        if (m.reset || m.id !== c.battle.id) c.battle = { id: m.id, lines: [] };
        c.battle.lines.push(...m.lines);
        for (const l of m.lines) if (l.startsWith('|request|')) c.request = JSON.parse(l.slice(9));
      }
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  c.sendRaw = s => c.ws.send(s);
  return c;
}
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });
const last = c => c.features.at(-1);

/** Two clients play a public in-app battle up to both leads being out. */
async function battle(host, guest, names, avatars) {
  host.send({ type: 'create', name: names[0], bestOf: 3, avatar: avatars[0], mode: 'app', visibility: 'public' });
  await until(() => host.state && host.joined, 'create ' + names[0]);
  const code = host.state.code;
  guest.send({ type: 'join', code, name: names[1], avatar: avatars[1] });
  await until(() => guest.state?.code === code && host.state.players[1], 'join ' + names[1]);
  await until(() => host.state.caller === 0 || host.state.caller === 1, 'caller');
  (host.state.caller === 0 ? host : guest).send({ type: 'call', side: 'heads' });
  await until(() => host.state.phase === 'spin', 'call');
  host.send({ type: 'spin' });
  await until(() => host.state.phase === 'pick', 'deal');
  (host.state.tossWinner === 0 ? host : guest).send({ type: 'pick', team: 0 });
  await until(() => host.request && guest.request, 'requests ' + code);
  host.send({ type: 'choose', choice: 'team 123456' }); guest.send({ type: 'choose', choice: 'team 123456' });
  await until(() => host.battle.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'leads ' + code);
  return code;
}

const [ana, beto, cami, dani, eli, flor, gus] = ['ana', 'beto', 'cami', 'dani', 'eli', 'flor', 'gus'].map(client);
for (const c of [ana, beto, cami, dani, eli, flor, gus]) await connect(c);
await until(() => [ana, beto, cami, dani, eli, flor, gus].every(c => c.hello), 'hello');
assert.equal(cami.hello.protocol, 9);

// ---- Validation: strict shape, plaza members only.
cami.send({ type: 'hubFeed', on: true });
await until(() => cami.errors.includes('Not in the plaza'), 'the feed is for plaza members');
cami.sendRaw(JSON.stringify({ type: 'hubFeed', on: 'yes' }));
cami.sendRaw(JSON.stringify({ type: 'hubFeed', on: true, code: 'ABCDEF' }));
await until(() => cami.errors.filter(e => e === 'Malformed message').length === 2, 'malformed feed messages are rejected');

// ---- Plaza members hear the featured battle (none yet) on entering.
cami.send({ type: 'hub', on: true, name: 'Cami', avatar: 'fuecoco', at: null });
dani.send({ type: 'hub', on: true, name: 'Dani', avatar: 'marill', at: null });
await until(() => cami.hub && dani.hub && cami.features.length && dani.features.length, 'feature on entering');
if (last(cami) !== null) throw new Error('feed.mjs needs a server with no live public battle; featured: ' + JSON.stringify(last(cami)));
cami.send({ type: 'hubFeed', on: true });

// ---- A public battle starts: it is featured, and Cami's feed carries its public lines.
const code1 = await battle(beto, ana, ['Beto', 'Ana'], ['lugia', 'greninja']);
await until(() => last(cami)?.code === code1 && last(dani)?.code === code1, 'the battle is featured for every plaza member');
assert.deepEqual(last(cami), { code: code1, names: ['Beto', 'Ana'], avatars: ['lugia', 'greninja'], wins: [0, 0], bestOf: 3 });
await until(() => cami.feed.code === code1 && cami.feed.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'feed lines');
const switches = cami.feed.lines.filter(l => l.startsWith('|switch|'));
assert.ok(switches.every(l => /\|\d+\/100( |$)/.test(l)), 'HP stays in percent: ' + switches.join(' '));
assert.ok(!cami.feed.lines.some(l => l.startsWith('|request|')), 'never a request (private sets)');
assert.ok(!cami.types.has('battle') && !cami.types.has('state') && !cami.types.has('joined'), 'never a player or spectator stream: ' + [...cami.types]);
assert.ok(!dani.types.has('hubFeed'), 'only members who opted in get the lines');
assert.equal(beto.state.watchers, 0, 'following the feed is not watching');

// The feed matches what a real spectator sees, line for line.
eli.send({ type: 'watch', code: code1 });
await until(() => eli.battle.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'spectator');
await until(() => beto.state.watchers === 1, 'one real watcher');
ana.send({ type: 'choose', choice: 'move 1' }); beto.send({ type: 'choose', choice: 'move 1' });
await until(() => eli.battle.lines.some(l => l.startsWith('|turn|2')), 'turn 2 for the spectator');
await until(() => cami.feed.lines.length >= eli.battle.lines.length, 'turn 2 for the feed');
assert.deepEqual(cami.feed.lines, eli.battle.lines, 'the feed is the spectator stream');

// Still in the plaza the whole time.
cami.send({ type: 'hubChat', text: 'great hit' });
await until(() => dani.lines.some(l => l.text === 'great hit'), 'a feed follower still chats in the plaza');

// Rate limit on toggling.
for (let i = 0; i < 6; i++) cami.send({ type: 'hubFeed', on: i % 2 === 1 });
await until(() => cami.errors.includes('Slow down'), 'feed toggles are rate limited');
await wait(1200);
cami.send({ type: 'hubFeed', on: true });
await wait(300);

// ---- A second battle; when the featured one ends, the plaza moves on to it.
const code2 = await battle(flor, gus, ['Flor', 'Gus'], ['toxel', 'kingambit']);
await wait(200);
assert.equal(last(cami).code, code1, 'the featured battle stays while it is live');
const resets = cami.feed.resets;
ana.send({ type: 'forfeit' });
await until(() => last(cami)?.code === code2, 'the feature moves to the next live battle');
await until(() => cami.feed.code === code2 && cami.feed.resets > resets && cami.feed.lines.filter(l => l.startsWith('|switch|')).length >= 2, 'the feed restarts with the new battle');
assert.deepEqual(last(dani).names, ['Flor', 'Gus']);
// Leaving the plaza leaves the feed.
cami.send({ type: 'hub', on: false });
await wait(150);
const n = cami.feed.lines.length;
flor.send({ type: 'choose', choice: 'move 1' }); gus.send({ type: 'choose', choice: 'move 1' });
await until(() => flor.battle.lines.some(l => l.startsWith('|turn|2')), 'turn 2 of battle 2');
await wait(200);
assert.equal(cami.feed.lines.length, n, 'no feed after leaving the plaza');
gus.send({ type: 'forfeit' });
await until(() => last(dani) === null, 'no battle on: the feature is null');

for (const c of [ana, beto, cami, dani, eli, flor, gus]) c.ws.close();
console.log('FEED_OK', { featured: [code1, code2], feedLines: n, spectatorMatch: true });
