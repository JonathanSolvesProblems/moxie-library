// B-roll for the demo video: one moving clip per beat, 1920x1080, recorded
// from the real page with a real browser. Nothing is staged: each clip drives
// the same page and the same library a visitor gets.
//
//   node scripts/capture_broll.mjs [--local] [--only 03]
//
// Records from the deployed page by default; --local serves site/ instead.
// Output: broll/NN-name.mp4 and broll/SHOTLIST.md. broll/ is not in git.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'broll');
const RAW = path.join(ROOT, 'tmp', 'broll_raw');
fs.mkdirSync(OUT, { recursive: true });
const LOCAL = process.argv.includes('--local');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const PORT = 4187;
const BASE = LOCAL ? `http://localhost:${PORT}` : 'https://moxie-library.vercel.app';

// Test sentences typed on camera. They are mine, and are test inputs, not hers.
const KITCHEN = 'I tried a new recipe tonight and set off the smoke alarm twice. The kids ordered pizza before I had finished apologising to the neighbours.';
const BIRTHDAY = 'I turned another year older this week and my knees filed a formal complaint. Nobody warned me that getting older would come with this much paperwork.';
const NEW_SUBJECT = 'The Treaty of Westphalia in 1648 ended the Thirty Years War and is often cited as the origin of the modern system of sovereign states.';

// A visible pointer, because a headless recording has none.
const POINTER = `
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:99;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;' +
      'border-radius:50%;background:rgba(242,237,232,.55);border:2px solid #0B1F23;pointer-events:none;' +
      'transition:transform .12s ease-out;will-change:left,top';
    document.documentElement.append(dot);
    addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
  });`;

const server = LOCAL ? spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.mjs'), String(PORT)], { stdio: 'pipe' }) : null;
if (server) await new Promise((resolve) => server.stdout.once('data', resolve));
const browser = await chromium.launch();
const shots = [];

const found = (page) => page.waitForFunction(() =>
  /been here before|already published/.test(document.getElementById('finds-title').textContent) &&
  document.getElementById('finds').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
const glide = async (page, x, y, ms = 900) => page.mouse.move(x, y, { steps: Math.max(8, Math.round(ms / 16)) });
const centre = async (page, selector, nth = 0) => {
  const box = await page.locator(selector).nth(nth).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const wheel = async (page, total, ms) => {
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, total / steps); await page.waitForTimeout(16); }
};

async function clip(id, name, what, run) {
  if (only && !id.startsWith(only)) return;
  const dir = path.join(RAW, id);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, colorScheme: 'dark',
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
    permissions: LOCAL ? ['clipboard-read', 'clipboard-write'] : [],
  });
  if (!LOCAL) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await context.addInitScript(POINTER);
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => document.getElementById('engine').dataset.state === 'ready', null, { timeout: 180000 });
  await page.mouse.move(960, 420);
  await page.waitForTimeout(600);
  const start = (Date.now() - t0) / 1000;            // everything before this is loading
  const began = Date.now();
  await run(page, context);
  await page.waitForTimeout(2200);                   // tail, so a clip is never shorter than its beat
  const seconds = (Date.now() - began) / 1000;
  await context.close();
  const webm = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => path.join(dir, f))[0];
  const out = path.join(OUT, `${id}-${name}.mp4`);
  spawnSync('ffmpeg', ['-y', '-ss', start.toFixed(2), '-i', webm, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-r', '30', '-an', out], { stdio: 'ignore' });
  shots.push({ file: `${id}-${name}.mp4`, seconds: Math.round(seconds), what });
  console.log(`${id}-${name}.mp4  ${Math.round(seconds)}s  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

// Her own public pages, recorded as a visitor sees them. Read-only: the script
// loads a page and scrolls it, nothing more. Used with her permission.
async function siteClip(id, name, what, url, run) {
  if (only && !id.startsWith(only)) return;
  const dir = path.join(RAW, id);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }, colorScheme: 'light',
    recordVideo: { dir, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(POINTER);
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  // Her theme is built for a laptop-width column; zoom it so it fills a 1080p frame.
  await page.addStyleTag({ content: 'html { zoom: 1.5; }' });
  await page.mouse.move(1880, 620);            // parked in the margin, off her links
  await page.waitForTimeout(2500);
  const start = (Date.now() - t0) / 1000;
  const began = Date.now();
  await run(page);
  await page.waitForTimeout(2200);
  const seconds = (Date.now() - began) / 1000;
  await context.close();
  const webm = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => path.join(dir, f))[0];
  const out = path.join(OUT, `${id}-${name}.mp4`);
  spawnSync('ffmpeg', ['-y', '-ss', start.toFixed(2), '-i', webm, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-r', '30', '-an', out], { stdio: 'ignore' });
  shots.push({ file: `${id}-${name}.mp4`, seconds: Math.round(seconds), what });
  console.log(`${id}-${name}.mp4  ${Math.round(seconds)}s  ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

try {
  await siteClip('00', 'her-blog-home', 'Her blog, moxie-dude.com, as a visitor sees it: the banner, then post after post scrolling by.',
    'https://www.moxie-dude.com/', async (page) => {
      await page.waitForTimeout(7500);          // hold on her banner for the opening line
      await wheel(page, 3600, 11000);
      await page.waitForTimeout(800);
    });

  await clip('01', 'ground-glide', 'The whole library at rest. The pointer travels along sixteen years of slabs and titles come up, tombstones and books.', async (page) => {
    await page.waitForTimeout(1500);
    const strip = await page.locator('#plots').boundingBox();
    const y = strip.y + strip.height * 0.45;
    await glide(page, strip.x + 60, y, 1200);
    for (const f of [0.14, 0.27, 0.4, 0.52, 0.63, 0.74, 0.86, 0.97]) {
      await glide(page, strip.x + strip.width * f, y + (f * 100 % 2 ? 14 : -10), 1100);
      await page.waitForTimeout(650);
    }
  });

  await clip('02', 'type-and-find', 'Two test sentences about a kitchen disaster are typed on the desk. Five of her pieces arrive, each with her own paragraph, and their slabs lift out of the ground.', async (page) => {
    await glide(page, ...(await centre(page, '#draft')), 800);
    await page.click('#draft');
    await page.keyboard.type(KITCHEN, { delay: 42 });
    await found(page);
    await page.waitForTimeout(6500);
  });

  await clip('03', 'read-results', 'Scrolling through what came back: her titles, her passages, how many years ago, in the ground or on the shelf.', async (page) => {
    await page.fill('#draft', KITCHEN);
    await found(page);
    await page.waitForTimeout(2200);
    await glide(page, 1400, 500, 700);
    await wheel(page, 1500, 7000);
    await page.waitForTimeout(1200);
    await wheel(page, -1500, 3000);
  });

  await clip('04', 'copy-link', 'One click copies a link to the first piece, and it is pasted into the draft: an old post back in circulation. Good closing shot.', async (page) => {
    await page.fill('#draft', KITCHEN);
    await found(page);
    await page.waitForTimeout(1800);
    // The button sits below the ground strip at this height, so scroll it up into view first.
    const below = (await page.locator('.find .btn--lamp').first().boundingBox()).y - 520;
    await glide(page, 1400, 480, 600);
    await wheel(page, below, 1300);
    await page.waitForTimeout(500);
    const [x, y] = await centre(page, '.find .btn--lamp');
    await glide(page, x, y, 1000);
    await page.waitForTimeout(300);
    await page.mouse.click(x, y);
    const label = await page.waitForFunction(() => {
      const t = document.querySelector('.find .btn--lamp').textContent;
      return t !== 'Copy link' ? t : null;
    }, null, { timeout: 8000 }).then((h) => h.jsonValue());
    if (label !== 'Copied') throw new Error(`copy button says "${label}"`);
    await page.waitForTimeout(1400);
    await wheel(page, -below, 1100);
    // Paste the copied link into the draft, the way she would in her editor.
    const url = await page.locator('.find__title a').first().getAttribute('href');
    const [dx, dy] = await centre(page, '#draft');
    await glide(page, dx, dy + 30, 900);
    await page.click('#draft');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.insertText(url);
    await page.waitForTimeout(3600);
  });

  await clip('05', 'nothing-close', 'A subject she has never written about. The page says so and shows nothing.', async (page) => {
    await glide(page, ...(await centre(page, '#draft')), 800);
    await page.click('#draft');
    await page.keyboard.type(NEW_SUBJECT, { delay: 30 });
    await page.waitForFunction(() => /Nothing close/.test(document.getElementById('finds-title').textContent), null, { timeout: 120000 });
    await page.waitForTimeout(6000);
  });

  await clip('06', 'offline', 'The network is switched off, then a new test draft is typed. The page still answers, and the line under the sheet says it is offline.', async (page, context) => {
    await context.setOffline(true);
    await page.waitForTimeout(800);
    await glide(page, ...(await centre(page, '#draft')), 800);
    await page.click('#draft');
    await page.keyboard.type(BIRTHDAY, { delay: 36 });
    await found(page);
    const [x, y] = await centre(page, '#engine');
    await glide(page, x - 40, y + 4, 1200);
    await page.waitForTimeout(5000);
  });

  await clip('07', 'open-tombstone', 'A tombstone is clicked. The piece opens with one line of hers, and the three pieces closest to it follow.', async (page) => {
    const [x, y] = await centre(page, '.plots .slab--tomb', 9);
    await glide(page, x, y, 1400);
    await page.waitForTimeout(1200);
    await page.mouse.click(x, y);
    await page.waitForFunction(() => /^From /.test(document.getElementById('finds-title').textContent), null, { timeout: 30000 });
    await page.waitForTimeout(3500);
    await glide(page, 1400, 480, 900);
    await wheel(page, 700, 3500);
    await page.waitForTimeout(1500);
  });

  await clip('08', 'title-search', 'Typing part of a title finds a piece from the keyboard and lights every slab that matches.', async (page) => {
    const [x, y] = await centre(page, '#seek');
    await glide(page, x, y, 1100);
    await page.mouse.click(x, y);
    await page.keyboard.type('hamster', { delay: 140 });
    await page.waitForSelector('#seek-list button');
    await page.waitForTimeout(3200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4200);
  });

  await clip('09', 'morning', 'The same graveyard after sunrise: the morning theme, then back to dusk.', async (page) => {
    await page.fill('#draft', KITCHEN);
    await found(page);
    await page.waitForTimeout(1500);
    const [x, y] = await centre(page, '#theme');
    await glide(page, x, y, 1100);
    await page.mouse.click(x, y);
    await page.waitForTimeout(3800);
    await page.mouse.click(x, y);
    await page.waitForTimeout(1500);
  });

  await clip('10', 'colophon', 'The bottom of the page: 9 times out of 19, what it cannot do, and the count of requests to other servers, which is 0.', async (page) => {
    await page.waitForTimeout(800);
    await glide(page, 960, 600, 600);
    await wheel(page, 1400, 3500);
    await page.waitForTimeout(6500);
  });

  await siteClip('11', 'her-post-2014', 'The 2014 post the library finds in the demo, on her own blog: the real piece behind the first result.',
    'https://www.moxie-dude.com/2014/03/26/when-a-picture-is-worth-1000-words-or-1000-reasons-why-i-should-never-try-to-cook-red-meat-ever-again/',
    async (page) => {
      await page.waitForTimeout(2200);
      await wheel(page, 1700, 8000);
      await page.waitForTimeout(800);
    });

  await siteClip('12', 'her-post-2011', 'The 2011 post "The story of my life" on her blog, the one whose line is "And then the kids woke up."',
    'https://www.moxie-dude.com/2011/04/17/the-story-of-my-life/',
    async (page) => {
      await page.waitForTimeout(3000);
      await wheel(page, 700, 5000);
      await page.waitForTimeout(800);
    });

  if (!only) {
    const lines = ['# B-roll shot list', '',
      `Recorded from ${BASE} on ${new Date().toISOString().slice(0, 10)}, 1920x1080, dusk theme, headless Chromium.`,
      'Every clip is the real page. The sentences typed on camera are test inputs written by Jonathan, not by Mona.',
      'Each clip runs about two seconds longer than its action so it can cover a narration beat.', '',
      '| Clip | Seconds | What happens |', '|---|---|---|',
      ...shots.map((s) => `| ${s.file} | ${s.seconds} | ${s.what} |`), ''];
    fs.writeFileSync(path.join(OUT, 'SHOTLIST.md'), lines.join('\n'));
    console.log('wrote broll/SHOTLIST.md');
  }
} catch (err) {
  console.log('CAPTURE FAILED:', err.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server?.kill();
}
