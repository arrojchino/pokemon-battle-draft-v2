// Fails when any user-facing source still carries Chinese, Japanese or Korean characters.
// node scripts/check-cjk.mjs   (scans frontend/src, frontend/index.html and shared/src; fonts and images are skipped)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const TARGETS = ['frontend/src', 'frontend/index.html', 'shared/src'];
const BINARY = new Set(['.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.glb', '.vrm', '.bin', '.mp3', '.ogg', '.wav']);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const hits = [];
function scan(path) {
  const st = statSync(path);
  if (st.isDirectory()) { for (const name of readdirSync(path)) if (name !== 'node_modules' && name !== 'dist') scan(join(path, name)); return; }
  if (BINARY.has(extname(path).toLowerCase())) return;
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => { if (CJK.test(line)) hits.push(`${relative(root, path)}:${i + 1}: ${line.trim().slice(0, 120)}`); });
}
for (const t of TARGETS) scan(join(root, t));
if (hits.length) { console.log(hits.join('\n')); console.log(`CJK_FOUND ${hits.length}`); process.exit(1); }
console.log('CJK_CLEAN');
