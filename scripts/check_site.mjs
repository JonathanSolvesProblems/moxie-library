// Drive the real page in a real browser and fail loudly if any promise the
// page makes is not kept.
//
//   node scripts/check_site.mjs [--shots] [--url https://deployed.example]
//
// Checks: the page loads with no console errors, the model loads from local
// files, no request leaves this origin, a draft built from one of her own
// passages finds that piece first, a subject she has never written about gets
// "nothing close", and the page still answers with the network switched off.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const SHOTS = process.argv.includes('--shots');
const shotDir = path.join(ROOT, 'tmp', 'shots');
if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });

const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'data', 'library.json'), 'utf8'));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};

// With --url the same checks run against a deployed copy instead of a local server.
const urlAt = process.argv.indexOf('--url');
const LIVE = urlAt > -1 ? process.argv[urlAt + 1].replace(/\/$/, '') : null;
const server = LIVE ? null : spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), String(PORT)], { stdio: 'pipe' });
if (server) await new Promise((resolve) => server.stdout.once('data', resolve));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: 'dark' });
const page = await context.newPage();
const errors = [], requests = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('request', (r) => requests.push(r.url()));
const shot = async (name, opts = {}) => { if (SHOTS) await page.screenshot({ path: path.join(shotDir, name), ...opts }); };
const origin = LIVE ?? `http://localhost:${PORT}`;
console.log(`checking ${origin}`);

try {
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('engine').dataset.state === 'ready' ||
    document.getElementById('engine').dataset.state === 'broken', null, { timeout: 120000 });
  const engine = await page.locator('#engine').textContent();
  check('model loads from local files', (await page.locator('#engine').getAttribute('data-state')) === 'ready', engine);
  check('tally matches the data', (await page.locator('#tally').textContent()).startsWith(`${lib.stats.pieces} pieces`));
  check('ground draws one slab per piece', (await page.locator('.plots .slab').count()) === lib.pieces.length,
    `${await page.locator('.plots .slab').count()} slabs`);
  check('tombstones match the never-linked count',
    (await page.locator('.plots .slab--tomb').count()) === lib.stats.pieces_never_linked_any_outlet);
  await shot('01-empty.png');

  // 1. One of her own middle passages, as a draft: the piece it came from must come back first.
  const probe = lib.pieces.findIndex((p) => p.outlet === 'Moxie-Dude' && p.date.startsWith('2013') && p.cn >= 3 && p.from.length === 0);
  const passage = lib.chunks[lib.pieces[probe].c0 + 1].t;
  await page.fill('#draft', passage);
  await page.waitForSelector('.find', { timeout: 60000 });
  const first = await page.locator('.find__title a').first().getAttribute('href');
  check('a passage of hers finds its own piece first', first === lib.pieces[probe].url, lib.pieces[probe].title);
  check('quoted passage is verbatim from the library',
    lib.chunks.some((c) => c.t.split('\n')[0] === undefined) === false &&
    (await page.locator('.find__hers').first().innerText()).replace(/\s+/g, ' ').trim() ===
      lib.chunks.find((c, r) => r >= lib.pieces[probe].c0 && r < lib.pieces[probe].c0 + lib.pieces[probe].cn &&
        c.t === passage).t.replace(/\s+/g, ' ').trim());
  check('the found slab lights up in the ground', (await page.locator('.plots .slab--lit').count()) >= 1);
  console.log('      closeness of the five shown:', await page.locator('.find').evaluateAll((n) => n.map((x) => x.dataset.score).join(' ')));
  await shot('02-found.png');

  // 2. A subject she has never written about.
  await page.fill('#draft', 'The Treaty of Westphalia in 1648 ended the Thirty Years War and is often cited as the origin of the modern system of sovereign states. Historians debate how far its clauses on territorial jurisdiction actually established the principle of non-interference between rulers.');
  await page.waitForFunction(() => /new|before|published/.test(document.getElementById('finds-title').textContent) &&
    document.getElementById('finds').getAttribute('aria-busy') === 'false', null, { timeout: 60000 });
  await page.waitForTimeout(900);
  const title = await page.locator('#finds-title').textContent();
  check('an unrelated subject gets "nothing close"', /Nothing close/.test(title), title);
  await shot('03-new-subject.png');

  // 3. Network off: the page must still answer.
  await context.setOffline(true);
  const offlineDraft = lib.chunks[lib.pieces[probe].c0].t;
  await page.fill('#draft', offlineDraft);
  await page.waitForSelector('.find', { timeout: 60000 });
  check('still answers with the network off', (await page.locator('.find').count()) >= 1);
  await context.setOffline(false);

  // 4. Click a tombstone: its closest pieces.
  await page.locator('.plots .slab--tomb').nth(40).click();
  await page.waitForSelector('.find', { timeout: 20000 });
  check('clicking a slab opens that piece', (await page.locator('.find').count()) >= 1, await page.locator('#finds-title').textContent());
  await shot('04-slab.png');

  // 5. Keyboard only: find a piece by its title and open it.
  await page.focus('#seek');
  await page.keyboard.type('pizza');
  await page.waitForSelector('#seek-list button', { timeout: 10000 });
  const offered = await page.locator('#seek-list button b').first().textContent();
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => document.querySelector('.find__title')?.textContent === t, offered, { timeout: 20000 });
  check('a piece can be found by title from the keyboard', /pizza/i.test(offered), offered);

  const foreign = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check('no request left this origin', foreign.length === 0, foreign.slice(0, 3).join(' '));
  check('the page reports the same count', /server since you opened it: 0\./.test(await page.locator('#privacy').textContent()));
  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  if (SHOTS) {
    await page.fill('#draft', passage);
    await page.waitForFunction(() => /been here before|already published/.test(document.getElementById('finds-title').textContent));
    await page.waitForTimeout(1500);
    await shot('05-found-settled.png');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await shot('05b-colophon.png');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('#theme').click();
    await page.waitForTimeout(300);
    await shot('06-morning.png');
  }
  const wasm = [...new Set(requests.filter((u) => /\.(wasm|onnx)$/.test(u)).map((u) => u.replace(origin, '')))];
  console.log('binary files fetched:', wasm.join(', '));
} catch (err) {
  check('run completed', false, err.message.split('\n')[0]);
  if (errors.length) console.log('console errors:', errors.slice(0, 5));
  await shot('99-failure.png');
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
