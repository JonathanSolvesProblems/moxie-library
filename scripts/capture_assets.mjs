// Record the real page doing its job, for the post: screenshots and one short
// silent video. Nothing here is staged data; it drives the same page and the
// same library a visitor gets.
//
//   node scripts/capture_assets.mjs [--url https://deployed.example]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'post', 'assets');
const RAW = path.join(ROOT, 'tmp', 'video');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(RAW, { recursive: true, force: true });
const PORT = 4183;

// What gets typed on camera: two test sentences of mine about a kitchen
// disaster, a subject she has written about often. They are a test input, not
// a sentence passed off as hers.
const TOPIC = 'I tried a new recipe tonight and set off the smoke alarm twice. The kids ordered pizza before I had finished apologising to the neighbours.';
const NEW_SUBJECT = 'The Treaty of Westphalia in 1648 ended the Thirty Years War and is often cited as the origin of the modern system of sovereign states.';

// With --url the recording is made from the deployed page, the one a reader opens.
const urlAt = process.argv.indexOf('--url');
const LIVE = urlAt > -1 ? process.argv[urlAt + 1].replace(/\/$/, '') : null;
const server = LIVE ? null : spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), String(PORT)], { stdio: 'pipe' });
if (server) await new Promise((resolve) => server.stdout.once('data', resolve));
const BASE = LIVE ?? `http://localhost:${PORT}`;
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 }, colorScheme: 'dark',
  recordVideo: { dir: RAW, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
const shot = (name, opts = {}) => page.screenshot({ path: path.join(OUT, name), timeout: 120000, ...opts });
const settled = async (pattern) => {
  await page.waitForFunction((src) => new RegExp(src).test(document.getElementById('finds-title').textContent) &&
    document.getElementById('finds').getAttribute('aria-busy') === 'false', pattern, { timeout: 120000 });
  await page.waitForTimeout(1800);   // let the cards and slabs finish their hop
};

try {
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => document.getElementById('engine').dataset.state === 'ready', null, { timeout: 180000 });
  const readyAt = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500);
  await shot('empty.png');

  await page.click('#draft');
  await page.keyboard.type(TOPIC, { delay: 22 });
  await settled('been here before|already published');
  await shot('found.png');
  console.log('found:', await page.locator('#finds-title').textContent(), '|',
    (await page.locator('.find__title').allTextContents()).map((t) => t.slice(0, 60)).join(' / '));
  console.log('closeness:', await page.locator('.find').evaluateAll((n) => n.map((x) => x.dataset.score).join(' ')));

  const lit = page.locator('.plots .slab--lit').first();
  await lit.hover();
  await page.waitForTimeout(1600);
  await page.locator('.ground').screenshot({ path: path.join(OUT, 'ground.png'), timeout: 120000 });
  await page.mouse.move(640, 200);

  await page.click('#clear');
  await page.keyboard.type(NEW_SUBJECT, { delay: 12 });
  await settled('Nothing close');
  await shot('nothing-close.png');

  await page.locator('.plots .slab--tomb').nth(60).click();
  await settled('^From ');
  await shot('slab.png');
  console.log('slab:', await page.locator('#finds-title').textContent(), '|', await page.locator('.find__title').first().textContent());

  await page.click('#theme');
  await page.waitForTimeout(1800);
  await shot('morning.png');
  await context.close();          // flushes the video
  await browser.close();

  const webm = fs.readdirSync(RAW).filter((f) => f.endsWith('.webm')).map((f) => path.join(RAW, f))[0];
  const start = Math.max(0, readyAt - 1).toFixed(1);   // cut the wait for the model
  const mp4 = path.join(OUT, 'demo.mp4');
  spawnSync('ffmpeg', ['-y', '-ss', start, '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-an', mp4], { stdio: 'ignore' });
  spawnSync('ffmpeg', ['-y', '-ss', start, '-i', webm, '-vf',
    'fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5',
    path.join(OUT, 'demo.gif')], { stdio: 'ignore' });
  for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(20), (fs.statSync(path.join(OUT, f)).size / 1e6).toFixed(2), 'MB');
} catch (err) {
  console.log('CAPTURE FAILED:', err.message.split('\n')[0]);
  await browser.close().catch(() => {});
  process.exitCode = 1;
} finally {
  server?.kill();
}
