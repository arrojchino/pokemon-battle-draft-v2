// A sleeping Pokémon can still switch out. Drives Pokémon Showdown's simulator directly with pool sets:
// the Spore user puts the rival's lead to sleep, then that sleeping lead switches. node tests/sleep.mjs
// (SHARED_DIST overrides where the compiled shared code lives; default ../dist/shared/src/index.js).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { BattleStream, getPlayerStreams, Teams } = createRequire(import.meta.url)('pokemon-showdown');
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

const sleeper = POOL.find(p => p.moves.includes('Spore'));
assert.ok(sleeper, 'the pool has a Spore user');
const spore = sleeper.moves.indexOf('Spore') + 1;
const pack = team => Teams.pack(Teams.import(teamImport(team)));
const rest = POOL.filter(p => p !== sleeper);

let verified = null;
for (let i = 0; i < rest.length && !verified; i++) {
  const lead = rest[i];
  const bench = rest.filter(p => p !== lead).slice(0, 5);
  const streams = getPlayerStreams(new BattleStream());
  const p1 = collect(streams.p1), p2 = collect(streams.p2);
  void streams.omniscient.write(`>start {"formatid":"gen9purehackmons","seed":[${i + 1},2,3,4]}\n` +
    `>player p1 ${JSON.stringify({ name: 'A', team: pack([sleeper, ...bench]) })}\n` +
    `>player p2 ${JSON.stringify({ name: 'B', team: pack([lead, ...bench]) })}`);
  await until(() => p1.req?.teamPreview && p2.req?.teamPreview, 'team preview');
  void streams.p1.write('team 1'); void streams.p2.write('team 1');
  await until(() => p2.lines.includes('|turn|1') && p2.req?.active, 'turn 1');
  void streams.p1.write(`move ${spore}`); void streams.p2.write('move 1');
  // A faster lead may knock the Spore user out first (p1 must then replace it): that lead is skipped.
  await until(() => p2.lines.includes('|turn|2') || p1.req?.forceSwitch || p2.req?.forceSwitch || p2.lines.some(l => l.startsWith('|win|')), 'turn 2');
  const asleep = p2.lines.some(l => l.startsWith('|-status|p2a: ') && l.includes('|slp'));
  const ready = asleep && p2.req?.active && !p2.req.forceSwitch && p2.lines.includes('|turn|2');
  if (!ready) { void streams.omniscient.writeEnd(); continue; } // immune (Grass type, ability, item) or fainted: next lead

  // The rival's HP reaches each player as a percentage only (exact HP would leak the hidden set).
  const hpOf = (lines, side) => lines.filter(l => /^\|(switch|-damage|-heal)\|/.test(l) && l.split('|')[2]?.startsWith(side)).map(l => l.split('|').pop());
  assert.ok(hpOf(p2.lines, 'p1a: ').length && hpOf(p2.lines, 'p1a: ').every(h => /^\d+\/100\b|^0 fnt/.test(h)), `p2 sees p1's HP as a percentage: ${hpOf(p2.lines, 'p1a: ')}`);
  assert.ok(hpOf(p2.lines, 'p2a: ').some(h => !/\/100\b/.test(h)), "p2 sees its own exact HP");

  const req = p2.req.active[0];
  assert.ok(!req.trapped && !req.maybeTrapped, 'sleep is not reported as trapping');
  const from = p2.lines.length;
  void streams.p2.write('switch 2'); void streams.p1.write('move 1');
  await until(() => p2.lines.slice(from).some(l => l.startsWith('|switch|p2a: ')), 'sleeping lead switches out');
  assert.ok(!p2.lines.slice(from).some(l => l.startsWith('|error|')), 'the switch is accepted');
  verified = { asleep: lead.name, switchedTo: bench[0].name, by: sleeper.name };
  void streams.omniscient.writeEnd();
}
assert.ok(verified, 'some lead must fall asleep');
console.log('SLEEP_SWITCH_OK', verified);
