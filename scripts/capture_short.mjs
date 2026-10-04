// Portrait b-roll for the YouTube Short: the live page in its phone layout,
// recorded at 1080x1920, one clip per beat. Playwright's recorder ignores
// deviceScaleFactor, so the app is recorded at a 1080x1920 viewport with the
// page zoomed 2.5x and its phone layout forced. Her blog is a sharp full-page
// phone screenshot scrolled by ffmpeg.
// Prints timing marks so the edit can be cut on the words.
//
//   node scripts/capture_short.mjs [--only p04]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'broll', 'vertical');
const RAW = path.join(ROOT, 'tmp', 'short_raw');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const BASE = 'https://moxie-library.vercel.app';
const VIEW = { width: 432, height: 768 };

const KITCHEN = 'I tried a new recipe tonight and set off the smoke alarm twice. The kids ordered pizza before I had finished apologising to the neighbours.';
const BIRTHDAY = 'I turned another year older this week and my knees filed a formal complaint. Nobody warned me that getting older would come with this much paperwork.';
const NEW_SUBJECT = 'The Treaty of Westphalia in 1648 ended the Thirty Years War and is often cited as the origin of the modern system of sovereign states.';

// Phone layout trims: no starter buttons, no colophon, so the beat fills the top of the frame.
const TRIM = `body { zoom: 2.5; } :root { --zoom: 2.5; }
  .mast { flex-wrap: wrap; padding-inline: 16px; } .desk { grid-template-columns: minmax(0,1fr); padding-inline: 16px; gap: 24px; }
  .sheet { position: static; } .ground { position: static; padding-inline: 16px; } .ground__head { grid-template-columns: minmax(0,1fr); }
  .seek { justify-self: stretch; } .seek input { width: 100%; } .find__why { margin-left: 0; text-align: left; }
  .starters, .colophon, .skip { display: none !important; }
  #draft { height: 150px !important; min-height: 0 !important; }`;

const browser = await chromium.launch();
const marks = {};
let began = 0;
const mark = (id, label) => {
  const t = (Date.now() - began) / 1000;
  (marks[id] ||= {})[label] = Math.round(t * 100) / 100;
  console.log(`    ${label} at ${t.toFixed(2)}s`);
};
const ease = async (page, fn, ms) => page.evaluate(([src, dur]) => new Promise((done) => {
  const step = new Function('k', src); const t0 = performance.now();
  const tick = (now) => { const k = Math.min(1, (now - t0) / dur); step(k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2); k < 1 ? requestAnimationFrame(tick) : done(); };
  requestAnimationFrame(tick);
}), [fn, ms]);
const scrollTo = (page, y, ms = 700) => ease(page, `window.scrollTo(0, ${window_from(page)} + (${y} - ${window_from(page)}) * k)`, ms);
function window_from() { return 'window.__y0'; }
async function smoothScroll(page, y, ms = 700) {
  await page.evaluate(() => { window.__y0 = window.scrollY; });
  await ease(page, `window.scrollTo(0, window.__y0 + (${y} - window.__y0) * k)`, ms);
}
const topOf = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY, sel);
const found = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('finds-title').textContent) &&
  document.getElementById('finds').getAttribute('aria-busy') === 'false', re, { timeout: 120000 });

async function clip(id, name, url, run, { app = true } = {}) {
  if (only && !id.startsWith(only)) return;
  const dir = path.join(RAW, id);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 }, colorScheme: app ? 'dark' : 'light',
    recordVideo: { dir, size: { width: 1080, height: 1920 } },
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  if (app) {
    await page.waitForFunction(() => document.getElementById('engine').dataset.state === 'ready', null, { timeout: 180000 });
    await page.addStyleTag({ content: TRIM });
  }
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(-10, -10);
  await page.waitForTimeout(800);
  const start = (Date.now() - t0) / 1000;
  began = Date.now();
  console.log(`${id}-${name}`);
  await run(page, context);
  await page.waitForTimeout(1500);
  await context.close();
  const webm = fs.readdirSync(dir).filter((f) => f.endsWith('.webm')).map((f) => path.join(dir, f))[0];
  const out = path.join(OUT, `${id}-${name}.mp4`);
  spawnSync('ffmpeg', ['-y', '-ss', start.toFixed(2), '-i', webm, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-r', '30', '-an', out], { stdio: 'ignore' });
  const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).stdout.toString().trim();
  console.log(`  -> ${path.basename(out)} ${(+dur).toFixed(1)}s`);
}

// Her blog in its own phone layout: a full-page screenshot at 432 px wide and
// 2.5x, then ffmpeg holds for `hold` seconds and scrolls `dist` css px over `secs`.
async function pageScroll(id, name, url, hold, secs, dist, total) {
  if (only && !id.startsWith(only)) return;
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2.5, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  const png = path.join(RAW, `${id}.png`);
  fs.mkdirSync(RAW, { recursive: true });
  await page.screenshot({ path: png, fullPage: true });
  await context.close();
  const px = dist * 2.5;
  const y = `if(lt(t,${hold}),0,if(lt(t,${hold + secs}),${px}*(0.5-0.5*cos(PI*(t-${hold})/${secs})),${px}))`;
  const out = path.join(OUT, `${id}-${name}.mp4`);
  spawnSync('ffmpeg', ['-y', '-loop', '1', '-framerate', '30', '-i', png, '-t', String(total),
    '-vf', `crop=1080:1920:0:'${y}'`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', out], { stdio: 'ignore' });
  console.log(`${id}-${name} -> ${path.basename(out)} ${total}s (scrolled screenshot)`);
}

// Pan the slab strip across the years, stopping on tombstones so their bubbles show.
async function panGround(page, secs, from = 0, to = 1) {
  const steps = 5;
  for (let s = 0; s <= steps; s++) {
    const k = from + (to - from) * (s / steps);
    await page.evaluate(() => { window.__x0 = document.getElementById('plots').scrollLeft; });
    await ease(page, `const p = document.getElementById('plots'); p.scrollLeft = window.__x0 + ((p.scrollWidth - p.clientWidth) * ${k} - window.__x0) * k`, 900);
    const box = await page.evaluate(() => {
      const p = document.getElementById('plots').getBoundingClientRect();
      const t = [...document.querySelectorAll('.plots .slab--tomb')].map((e) => e.getBoundingClientRect())
        .filter((r) => r.left > p.left + 60 && r.right < p.right - 60);
      const r = t[Math.floor(t.length * 0.45)];
      return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    if (box) await page.mouse.move(box.x, box.y, { steps: 12 });
    await page.waitForTimeout(Math.max(200, (secs * 1000) / (steps + 1) - 1100));
  }
}

try {
  await clip('p01', 'poster', `${BASE}/`, async (page) => {
    await page.addStyleTag({ content: `.desk { display: none !important; }
      .poster-words { padding: 120px 22px 70px; }
      .poster-words p { font: italic 500 2.15rem/1.22 var(--hers); }
      .poster-words span { display: block; font: 800 0.72rem/1.4 var(--says); text-transform: uppercase; letter-spacing: 0.09em; color: var(--chalk-dim); margin-top: 18px; }` });
    await page.evaluate(() => {
      const s = document.createElement('section'); s.className = 'poster-words';
      const p = document.createElement('p'); p.textContent = '“Don’t treat your content like a graveyard. Treat it like a library.”';
      const w = document.createElement('span'); w.textContent = 'Mona Andrei, on the poster she made';
      s.append(p, w); document.querySelector('main').prepend(s);
    });
    await panGround(page, 12.5, 0, 0.5);
  });

  await pageScroll('p02', 'blog', 'https://www.moxie-dude.com/', 3.8, 4.5, 1100, 10.5);

  await clip('p03', 'ground', `${BASE}/`, async (page) => {
    await page.addStyleTag({ content: '.desk { display: none !important; } .ground { margin-top: 90px; }' });
    await page.waitForTimeout(300);
    await panGround(page, 12, 0, 1);
  });

  await clip('p04', 'desk', `${BASE}/`, async (page) => {
    await page.click('#draft');
    mark('p04', 'typing');
    await page.keyboard.type(KITCHEN, { delay: 38 });
    await found(page, 'been here before|already published');
    mark('p04', 'results');
    await page.waitForTimeout(700);
    await smoothScroll(page, (await topOf(page, '#finds')) - 30, 900);
    await page.waitForTimeout(8000);
  });

  await pageScroll('p05', 'post-2014', 'https://www.moxie-dude.com/2014/03/26/when-a-picture-is-worth-1000-words-or-1000-reasons-why-i-should-never-try-to-cook-red-meat-ever-again/', 0.8, 2.0, 650, 5.5);

  await clip('p06', 'nothing-close', `${BASE}/`, async (page) => {
    await page.click('#draft');
    await page.keyboard.type(NEW_SUBJECT, { delay: 26 });
    await found(page, 'Nothing close');
    mark('p06', 'results');
    await page.waitForTimeout(4000);
  });

  await clip('p07', 'offline', `${BASE}/`, async (page, context) => {
    await context.setOffline(true);
    await page.click('#draft');
    await page.keyboard.type(BIRTHDAY, { delay: 26 });
    await found(page, 'been here before|already published');
    mark('p07', 'results');
    await page.waitForTimeout(4500);
  });

  await clip('p08', 'tombstone', `${BASE}/`, async (page) => {
    await page.addStyleTag({ content: '.desk .sheet { display: none !important; }' });
    await smoothScroll(page, (await topOf(page, '.ground')) - 40, 10);
    await page.evaluate(() => { document.getElementById('plots').scrollLeft = 0; });
    const tomb = page.locator('.plots .slab--tomb').nth(9);
    const b = await tomb.boundingBox();
    await page.mouse.move(b.x + 150, b.y - 60);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 40 });
    await page.waitForTimeout(1600);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    mark('p08', 'clicked');
    await page.waitForFunction(() => /^From /.test(document.getElementById('finds-title').textContent));
    await page.waitForTimeout(300);
    await smoothScroll(page, (await topOf(page, '.find')) - 20, 800);
    await page.waitForTimeout(14000);
  });

  await clip('p09', 'copy-paste', `${BASE}/`, async (page) => {
    await page.fill('#draft', KITCHEN);
    await found(page, 'been here before|already published');
    await smoothScroll(page, (await topOf(page, '.find')) - 20, 10);
    await page.waitForTimeout(2000);
    const btn = await page.locator('.find .btn--lamp').first().boundingBox();
    await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2, { steps: 15 });
    await page.mouse.click(btn.x + btn.width / 2, btn.y + btn.height / 2);
    mark('p09', 'copy clicked');
    await page.waitForTimeout(700);
    const url = await page.locator('.find__title a').first().getAttribute('href');
    await smoothScroll(page, 0, 500);
    await page.click('#draft');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(url);
    mark('p09', 'pasted');
    await page.waitForTimeout(9000);
  });
} finally {
  await browser.close();
  const f = path.join(OUT, 'marks.json');
  const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
  fs.writeFileSync(f, JSON.stringify({ ...prev, ...marks }, null, 1));
}
