// Revival Blessing: the user picks a FAINTED party member to bring back. Drives Pokémon Showdown's
// simulator directly with pool sets and checks the request the client has to answer: a forced switch,
// the active Pokémon flagged `reviving`, and `switch <fainted slot>` accepted. node tests/revive.mjs
// (SHARED_DIST overrides where the compiled shared code lives; default ../dist/shared/src/index.js).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { BattleStream, getPlayerStreams, Teams, Dex } = createRequire(import.meta.url)('pokemon-showdown');
const { POOL, teamImport } = await import(new URL(process.env.SHARED_DIST ?? '../dist/shared/src/index.js', import.meta.url));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, label, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return; await wait(5); } throw new Error('timeout: ' + label); };

function collect(stream) {
  const c = { lines: [], req: null };
  (async () => {
    for await (const chunk of stream) for (const l of chunk.split('\n')) {
      c.lines.push(l);
      if (l.startsWith('|request|')) c.req = JSON.parse(l.slice(9));
    }
  })();
  return c;
}

const byName = n => POOL.find(p => p.name === n);
const reviver = POOL.find(p => p.moves.includes('Revival Blessing'));
assert.ok(reviver, 'the pool has a Revival Blessing user');
const lead = byName('Dragapult');            // uses Dragon Dance on turn 1, then faints to the attack
const attacker = byName('Kingambit') ?? POOL.find(p => p !== reviver && p !== lead);
const status = set => set.moves.findIndex(m => Dex.moves.get(m).category === 'Status') + 1;
const hits = (set, target) => set.moves.findIndex(m => { const mv = Dex.moves.get(m); return mv.category !== 'Status' && Dex.getImmunity(mv.type, target.types) && mv.priority >= 0; }) + 1;
assert.ok(status(lead) && hits(attacker, lead) && status(attacker), 'sets fit the scenario');

const others = POOL.filter(p => ![reviver, lead, attacker].includes(p)).slice(0, 4);
const pack = team => Teams.pack(Teams.import(teamImport(team)));
const streams = getPlayerStreams(new BattleStream());
const p1 = collect(streams.p1), p2 = collect(streams.p2);
void streams.omniscient.write(`>start {"formatid":"gen9purehackmons","seed":[1,2,3,4]}\n` +
  `>player p1 ${JSON.stringify({ name: 'A', team: pack([attacker, ...others]) })}\n` +
  `>player p2 ${JSON.stringify({ name: 'B', team: pack([lead, reviver, ...others]) })}`);
await until(() => p1.req?.teamPreview && p2.req?.teamPreview, 'team preview');
void streams.p1.write('team 1'); void streams.p2.write('team 1');
await until(() => p2.lines.includes('|turn|1') && p2.req?.active, 'turn 1');

// Turn 1: the lead is left at 1 HP, sets up, and goes down to the attack.
void streams.omniscient.write('>eval p2.pokemon[0].hp = 1');
void streams.p2.write(`move ${status(lead)}`); void streams.p1.write(`move ${hits(attacker, lead)}`);
await until(() => p2.req?.forceSwitch?.[0], 'p2 replaces the fainted lead');
assert.ok(p2.lines.some(l => l.startsWith(`|faint|p2a: ${lead.name}`)), 'the lead fainted');
const reviverSlot = p2.req.side.pokemon.findIndex(p => p.ident.endsWith(reviver.name)) + 1;
void streams.p2.write(`switch ${reviverSlot}`);
await until(() => p2.lines.includes('|turn|2') && p2.req?.active, 'turn 2');

// Turn 2: Revival Blessing (the attacker only sets up, so the reviver survives to use it).
void streams.p2.write(`move ${reviver.moves.indexOf('Revival Blessing') + 1}`); void streams.p1.write(`move ${status(attacker)}`);
await until(() => p2.req?.forceSwitch?.[0] && p2.req.side.pokemon.some(p => p.reviving), 'revival request');
const req = p2.req;
const active = req.side.pokemon.find(p => p.active);
assert.equal(active.ident.endsWith(reviver.name), true, 'the reviver is the active Pokémon');
assert.equal(active.reviving, true, 'the active Pokémon carries reviving: true');
assert.ok(!req.active, 'no move choices during a revival');
const fainted = req.side.pokemon.findIndex(p => p.condition.endsWith(' fnt'));
const healthy = req.side.pokemon.findIndex(p => !p.active && !p.condition.endsWith(' fnt'));
assert.ok(fainted >= 0 && healthy >= 0);

// A healthy bench Pokémon is rejected; the fainted one is accepted and comes back.
let from = p2.lines.length;
void streams.p2.write(`switch ${healthy + 1}`);
await until(() => p2.lines.slice(from).some(l => l.startsWith('|error|')), 'healthy target rejected');
from = p2.lines.length;
void streams.p2.write(`switch ${fainted + 1}`);
await until(() => p2.lines.slice(from).some(l => l.startsWith(`|-heal|p2: ${lead.name}|`) && l.includes('Revival Blessing')), 'fainted target revived');
void streams.omniscient.writeEnd();
console.log('REVIVE_OK', { reviver: reviver.name, revived: lead.name, rejected: req.side.pokemon[healthy].ident });
