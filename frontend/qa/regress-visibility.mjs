// Regression: Pokémon must stay visible and lit through focus, visibility and WebGL context changes.
//
//   node qa/regress-visibility.mjs [appUrl]      (default: the dev server against the dev backend)
//
// Drives Microsoft Edge (or Chrome: set BROWSER) headless over the DevTools protocol, no dependencies. Two pages
// enter the main plaza with different partners, so each sees a local and a remote Pokémon. For every visible
// Pokémon it renders a frame and reads back the pixels over its body: the check fails when a Pokémon's meshes are
// hidden, it leaves the scene, or its body comes out much darker than before (the bug this guards: after a lost
// WebGL context the prefiltered environment map came back empty and every Pokémon turned near black).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.argv[2] ?? 'http://127.0.0.1:5170/pokemon-battle-draft-v2/?ws=ws://127.0.0.1:8899';
const BROWSER = process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const RUN_SECONDS = Number(process.env.RUN_SECONDS ?? 60);
const PORT = 9300 + Math.floor(Math.random() * 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'pbd-vis-'));
const browser = spawn(BROWSER, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1280,760',
  '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let failures = 0;
const log = (...a) => console.log(...a);
const fail = msg => { failures++; console.log(`  FAIL ${msg}`); };

async function cdpConnect() {
  for (let i = 0; i < 50; i++) {
    try { const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); return v.webSocketDebuggerUrl; } catch { await sleep(200); }
  }
  throw new Error('browser did not start');
}
const ws = new WebSocket(await cdpConnect());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId }));
});

async function openPage(name, partner) {
  // Each trainer gets its own browser context: separate storage, so separate settings and plaza identity.
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = {
    name, targetId,
    eval: async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result.value;
    },
    send: (m, p) => send(m, p, sessionId),
  };
  await page.send('Page.enable'); await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
  const origin = new URL(APP).origin;
  await page.send('Page.navigate', { url: origin + '/favicon.ico' });
  await sleep(500);
  await page.eval(`localStorage.setItem('pab-settings', JSON.stringify({ name: ${JSON.stringify(name)}, partner: ${JSON.stringify(partner)}, intro: 'seen' })); sessionStorage.setItem('pab-intro', '1'); 1`);
  await page.send('Page.navigate', { url: APP });
  return page;
}

// In-page probe: for every Pokémon on stage, its mesh state and the mean brightness of the pixels over its body.
const PROBE = `(() => {
  const W = window.__WORLD__; if (!W) return null;
  const gl = W.renderer.getContext(), c = W.renderer.domElement;
  W.composer.render(0);
  const out = {};
  for (const [key, r] of W.rigs) {
    if (!r.root.visible || !r.isShown || r.appear < 0.98) continue;
    let meshes = 0, shown = 0, inScene = false;
    for (let p = r.root; p; p = p.parent) if (p === W.scene) inScene = true;
    r.root.traverse(o => { if (!o.isMesh) return; meshes++; let v = true; for (let q = o; q; q = q.parent) if (!q.visible) v = false; if (v) shown++; });
    const at = (y) => { const v = r.root.position.clone(); v.y += y; v.project(W.camera); return { x: (v.x * 0.5 + 0.5) * c.width, y: (v.y * 0.5 + 0.5) * c.height, z: v.z }; };
    const foot = at(0.1 * r.height), head = at(0.85 * r.height);
    if (foot.z > 1 || head.z > 1) continue;
    const x0 = Math.round(foot.x), ya = Math.round(Math.min(foot.y, head.y)), yb = Math.round(Math.max(foot.y, head.y));
    const h = Math.max(2, yb - ya), w = Math.max(4, Math.round(h * 0.35));
    if (x0 - w / 2 < 0 || x0 + w / 2 > c.width || ya < 0 || yb > c.height) continue;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(Math.round(x0 - w / 2), ya, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let lum = 0; for (let i = 0; i < px.length; i += 4) lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    out[key] = { meshes, shown, inScene, lum: lum / (w * h) / 255 };
  }
  return { stage: W.stage, running: W.running, lost: gl.isContextLost(), rigs: out };
})()`;

async function waitFor(page, expr, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await page.eval(expr)) return true; } catch {} await sleep(400); }
  return false;
}
async function enterPlaza(page) {
  // A page in a background tab does not render (the World stops while hidden), so bring it forward first.
  await page.send('Page.bringToFront');
  if (!(await waitFor(page, `!!window.__WORLD__`, 30000))) throw new Error(`${page.name}: World never started`);
  // The plaza is home; on an older build the title menu has a Plaza entry.
  if (!(await waitFor(page, `window.__WORLD__.stage === 'hub'`, 6000))) {
    await page.eval(`[...document.querySelectorAll('button, a')].find(e => /^\\s*Plaza/.test(e.textContent || ''))?.click(); 1`);
  }
  if (!(await waitFor(page, `window.__WORLD__.stage === 'hub' && [...window.__WORLD__.rigs.values()].some(r => r.root.visible && r.appear > 0.98)`, 45000)))
    throw new Error(`${page.name}: never reached the plaza with a visible partner: ${await page.eval(`JSON.stringify({ stage: window.__WORLD__.stage, hidden: document.hidden, running: window.__WORLD__.running, rigs: [...window.__WORLD__.rigs].map(([k, r]) => [k, r.root.visible, +r.appear.toFixed(2)]), err: document.querySelector('.toast')?.textContent })`).catch(e => e.message)}`);
  await sleep(2500);
}

const baseline = new Map();
async function check(page, label, { expectKeys = 1 } = {}) {
  await page.send('Page.bringToFront');
  await sleep(1200);
  const p = await page.eval(PROBE);
  if (!p) return fail(`${page.name} ${label}: no World`);
  if (!p.running) fail(`${page.name} ${label}: render loop not running`);
  const keys = Object.keys(p.rigs);
  if (keys.length < expectKeys) fail(`${page.name} ${label}: ${keys.length} Pokémon measurable, expected ${expectKeys}`);
  const parts = [];
  for (const k of keys) {
    const r = p.rigs[k], id = `${page.name}:${k}`;
    if (!r.inScene) fail(`${id} ${label}: not in the scene`);
    if (r.shown < r.meshes - 1) fail(`${id} ${label}: ${r.shown}/${r.meshes} meshes visible`);
    if (!baseline.has(id)) baseline.set(id, r.lum);
    const ratio = r.lum / baseline.get(id);
    if (ratio < 0.6) fail(`${id} ${label}: body brightness ${(ratio * 100).toFixed(0)}% of baseline (dark or missing)`);
    parts.push(`${k} ${(r.lum * 100).toFixed(1)}% (${(ratio * 100).toFixed(0)}%)`);
  }
  log(`  ok? ${page.name} ${label}: ${parts.join(', ')}`);
}

try {
  log(`app ${APP}`);
  const a = await openPage('Ana', 'greninja');
  await enterPlaza(a);
  const b = await openPage('Beto', 'feraligatr');
  await enterPlaza(b);
  // Beto walks up beside Ana's partner, so each camera has both Pokémon in frame.
  const at = await a.eval(`JSON.stringify(window.__WORLD__.plaza.spot())`).then(JSON.parse);
  await b.send('Page.bringToFront');
  await b.eval(`window.__WORLD__.plaza.walkTo(${at.x + 1.7}, ${at.z}); 1`);
  await sleep(6000);
  await a.send('Page.bringToFront'); await sleep(3000);
  if (process.env.DIAG) {
    log('DIAG ' + await a.eval(`(() => { const W = window.__WORLD__, env = W.scene.environment, p = () => Object.values(${PROBE}.rigs).map(r => (r.lum * 100).toFixed(1)).join('/');
      const on = p(); W.scene.environment = null; const off = p(); W.scene.environment = env; return 'tier ' + W.tier + ' lum with env ' + on + ' without ' + off; })()`));
  }
  await check(a, 'baseline (local + remote)', { expectKeys: 2 });
  await check(b, 'baseline (local + remote)', { expectKeys: 2 });

  log('switching tabs back and forth (5x)');
  for (let i = 0; i < 5; i++) { await b.send('Page.bringToFront'); await sleep(700); await a.send('Page.bringToFront'); await sleep(700); }
  log(`  page Ana hidden while Beto was in front: ${await (async () => { await b.send('Page.bringToFront'); await sleep(400); const h = await a.eval('document.hidden'); await a.send('Page.bringToFront'); return h; })()}`);
  await check(a, 'after tab switches', { expectKeys: 2 });

  log('window blur and focus (5x), and visibility hidden/visible as on minimise (3x)');
  for (let i = 0; i < 5; i++) await a.eval(`window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); 1`);
  for (let i = 0; i < 3; i++) {
    await a.eval(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); 1`);
    await sleep(800);
    await a.eval(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); 1`);
    await sleep(500);
  }
  await check(a, 'after blur/focus and hide/show', { expectKeys: 2 });

  log('WebGL context lost and restored (3x)');
  for (let i = 0; i < 3; i++) {
    await a.eval(`(window.__lc = window.__WORLD__.renderer.getContext().getExtension('WEBGL_lose_context')).loseContext(); 1`);
    await sleep(700);
    await a.eval(`window.__lc.restoreContext(); 1`);
    await waitFor(a, `!window.__WORLD__.renderer.getContext().isContextLost() && window.__WORLD__.running`, 8000);
    await sleep(800);
    await check(a, `after context restore #${i + 1}`, { expectKeys: 2 });
  }

  log('plaza -> partner select -> plaza');
  await a.eval(`(document.querySelector('[data-nav="partner"]') || [...document.querySelectorAll('button')].find(e => /partner/i.test(e.getAttribute('aria-label') || e.textContent || '')))?.click(); 1`);
  if (await waitFor(a, `window.__WORLD__.layout?.mode === 'select'`, 8000)) {
    await sleep(1500);
    await a.eval(`[...document.querySelectorAll('button')].find(e => /^\\s*Back/i.test(e.textContent || '') || e.getAttribute('aria-label') === 'Back')?.click(); 1`);
    if (await waitFor(a, `window.__WORLD__.stage === 'hub'`, 10000)) { await sleep(2500); await check(a, 'after partner select round trip', { expectKeys: 2 }); }
    else fail('Ana: did not come back to the plaza from partner select');
  } else log('  (skipped: partner select not reachable from this build)');

  log('watching a live battle and stopping (when one is live)');
  // Open whatever lists live battles (the Watch menu, or the older Battles panel) and look for a Watch button.
  await a.eval(`(document.querySelector('[data-nav="watch"]') || [...document.querySelectorAll('button')].find(e => /^\\s*Battles\\s*$/i.test(e.textContent || '')))?.click(); 1`);
  const findWatch = `[...document.querySelectorAll('button')].find(e => /^\\s*Watch\\s*$/i.test(e.textContent || ''))`;
  const live = await waitFor(a, `!!${findWatch}`, 8000);
  if (live) {
    await a.eval(`${findWatch}.click(); 1`);
    if (await waitFor(a, `window.__WORLD__.stage === 'arena'`, 15000)) {
      await sleep(3000);
      await check(a, 'while spectating', { expectKeys: 1 });
      await a.eval(`[...document.querySelectorAll('button')].find(e => /stop watching/i.test(e.textContent || ''))?.click(); 1`);
      if (await waitFor(a, `window.__WORLD__.stage === 'hub'`, 15000)) { await sleep(3000); await check(a, 'after stopping watching', { expectKeys: 2 }); }
      else fail('Ana: did not return to the plaza after watching');
    } else log('  (skipped: could not open the live battle)');
  } else log('  (skipped: no live battle on this server)');

  log(`running ${RUN_SECONDS}s with checks every 15s`);
  for (let t = 0; t < RUN_SECONDS; t += 15) { await sleep(15000); await check(a, `after ${t + 15}s`, { expectKeys: 2 }); }
} catch (e) {
  fail(e.message);
} finally {
  try { await send('Browser.close'); } catch {}
  browser.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(failures ? `VISIBILITY_FAIL ${failures}` : 'VISIBILITY_OK');
process.exit(failures ? 1 : 0);
