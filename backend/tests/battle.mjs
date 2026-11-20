// In-app battles end to end: two WebSocket clients draft and then play real simulator battles with random
// legal choices until a best-of-3 completes. Run against a server started with short timers, e.g.
//   BATTLE_DECISION_SECONDS=3 PORT=8787 npm start   then   node tests/battle.mjs
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const URL = process.env.TEST_URL || 'ws://127.0.0.1:8787';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(10); } throw new Error('timeout: ' + label); };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function client(label) {
  const c = { label, state: null, joined: null, errors: [], battle: { id: 0, lines: [], resets: 0 }, request: null, idle: false, choices: 0 };
  c.attach = ws => {
    c.ws = ws;
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'state') c.state = m.room;
      if (m.type === 'joined') c.joined = m;
      if (m.type === 'error') c.errors.push(m.message);
      if (m.type === 'battle') {
        if (m.reset || m.id !== c.battle.id) { c.battle = { id: m.id, lines: [], resets: c.battle.resets + (m.reset ? 1 : 0) }; }
        c.battle.lines.push(...m.lines);
        c.deadline = m.deadline;
        for (const l of m.lines) if (l.startsWith('|request|')) { c.request = JSON.parse(l.slice(9)); if (!m.reset) c.decide(); }
      }
    });
  };
  c.send = msg => c.ws.send(JSON.stringify(msg));
  /** Random legal choice from the request, like a (very casual) human. */
  c.decide = () => {
    const r = c.request; if (!r || r.wait || c.idle) return;
    let choice;
    if (r.teamPreview) choice = 'team ' + [1, 2, 3, 4, 5, 6].sort(() => Math.random() - 0.5).join('');
    else if (r.forceSwitch) {
      const ok = r.side.pokemon.map((p, i) => ({ p, i })).filter(({ p }) => !p.active && !p.condition.endsWith(' fnt'));
      choice = ok.length ? `switch ${pick(ok).i + 1}` : 'default';
    } else {
      const a = r.active[0];
      const moves = a.moves.map((m, i) => ({ m, i })).filter(({ m }) => !m.disabled && (m.pp === undefined || m.pp > 0));
      const bench = r.side.pokemon.map((p, i) => ({ p, i })).filter(({ p }) => !p.active && !p.condition.endsWith(' fnt'));
      if (bench.length && !a.trapped && Math.random() < 0.12) choice = `switch ${pick(bench).i + 1}`;
      else if (moves.length) choice = `move ${pick(moves).i + 1}${a.canTerastallize && Math.random() < 0.3 ? ' terastallize' : ''}`;
      else choice = 'default';
    }
    c.choices++;
    setTimeout(() => c.send({ type: 'choose', choice }), 5);
  };
  return c;
}
const connect = c => new Promise((res, rej) => { const ws = new WebSocket(URL); c.attach(ws); ws.once('open', () => res(ws)); ws.once('error', rej); });

const a = client('a'), b = client('b');
await connect(a); await connect(b);
a.send({ type: 'create', name: 'Ana', bestOf: 3, avatar: 'rei', mode: 'app' });
await until(() => a.state, 'create');
assert.equal(a.state.mode, 'app');
const code = a.state.code;
b.send({ type: 'join', code, name: 'Beto', avatar: 'mirei' });
await until(() => a.state.players[1], 'join');

let forfeited = 0, reconnected = false, timerChecked = false, g1Winner = -1;
let bRef = b;
for (let game = 1; a.state.phase !== 'complete'; game++) {
  assert.ok(game <= 6, 'series must finish');
  a.send({ type: 'call', side: 'heads' }); bRef.send({ type: 'call', side: 'tails' });
  await until(() => a.state.calls.every(Boolean), 'calls');
  a.send({ type: 'flip' }); await until(() => a.state.phase === 'spin', 'flip');
  a.send({ type: 'spin' }); await until(() => a.state.phase === 'pick', 'deal');
  (a.state.tossWinner === 0 ? a : bRef).send({ type: 'pick', team: 0 });
  await until(() => a.state.phase === 'battle' && a.state.battle, 'battle starts');
  const id = a.state.battle.id;
  await until(() => a.battle.id === id && bRef.battle.id === id && a.request && bRef.request, 'requests arrive');

  // Hidden information stays hidden: each side's stream only has its own |request|.
  assert.ok(a.battle.lines.some(l => l.startsWith('|request|')));
  const aReq = a.battle.lines.filter(l => l.startsWith('|request|')).map(l => JSON.parse(l.slice(9)));
  assert.ok(aReq.every(r => !r.side || r.side.id === 'p1'), 'p1 must never receive p2 requests');

  if (game === 1) {
    a.send({ type: 'result', winner: 0 });
    await until(() => a.errors.includes('This battle is decided in the arena'), 'manual result blocked in app mode');
    a.send({ type: 'choose', choice: 'move 9' });
    await until(() => a.errors.includes('Malformed message'), 'invalid choice rejected');
    a.decide(); bRef.decide();
  }
  if (game === 1 && !timerChecked) {
    // B stops answering for one decision; the server's timer must play for them.
    await until(() => a.state.battle?.turn >= 2, 'reach turn 2', 60000);
    const before = bRef.battle.lines.filter(l => l.startsWith('|turn|')).length;
    bRef.idle = true;
    await until(() => bRef.deadline, 'deadline announced');
    await until(() => bRef.battle.lines.filter(l => l.startsWith('|turn|')).length > before, 'timer advanced the battle', 12000);
    bRef.idle = false; bRef.decide(); timerChecked = true;
  }
  if (game === 2 && !reconnected) {
    // Refresh mid-battle: resume with the token and receive the full log back.
    await until(() => a.state.battle?.turn >= 3, 'reach turn 3', 60000);
    const token = bRef.joined.token; const had = bRef.battle.lines.length;
    bRef.ws.close();
    const b2 = client('b2'); await connect(b2);
    b2.send({ type: 'resume', code, token });
    await until(() => b2.battle.resets === 1 && b2.battle.lines.length >= had, 'battle log replayed on resume');
    assert.ok(b2.battle.lines.slice(0, 20).join('\n').includes('|player|p2|'), 'replay starts from the beginning');
    bRef = b2; bRef.decide(); reconnected = true;
    // The game 1 winner forfeits, so the series always reaches a decider and both forfeit paths run.
    (g1Winner === 0 ? a : bRef).send({ type: 'forfeit' }); forfeited++;
  }
  if (game === 3) { await until(() => a.state.battle?.turn >= 1, 'turn 1 before forfeit', 60000); bRef.send({ type: 'forfeit' }); forfeited++; }

  const before = a.state.games;
  await until(() => a.state.games > before || (a.state.phase === 'calls' && !a.state.battle), `game ${game} ends`, 180000);
  const last = a.state.history[a.state.history.length - 1];
  if (game === 1) g1Winner = last.winner;
  if (game === 2) assert.equal(last.winner, 1 - g1Winner, 'forfeit gives the game to the other seat');
  if (game === 3) assert.equal(last.winner, 0, 'B forfeited the decider');
  console.log(`game ${game}: ${a.state.phase} winner=${last ? ['Ana', 'Beto'][last.winner] : 'draw'} turns=${last?.turns} choices a=${a.choices} b=${bRef.choices}`);
  if (a.state.phase === 'between') { a.send({ type: 'next' }); await until(() => a.state.phase === 'calls', 'next'); }
  a.request = null; bRef.request = null;
}
assert.equal(a.state.phase, 'complete');
assert.equal(forfeited, 2, 'both forfeits ran');
assert.deepEqual(a.state.wins, [2, 1]);
assert.ok(a.state.history.every(h => typeof h.turns === 'number' && h.turns > 0), 'turn counts recorded');
console.log('BATTLE_OK', { code, wins: a.state.wins, timerChecked, reconnected, forfeited });
a.ws.close(); bRef.ws.close();
process.exit(0);
