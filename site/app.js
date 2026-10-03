// The Moxie Library. No framework and no build step: this file, a worker, and
// two data files. Everything the page shows about a piece comes from
// data/library.json; nothing here writes a sentence on Mona's behalf.

const $ = (id) => document.getElementById(id);
const OUTLET = {
  'Moxie-Dude': { key: 'moxie', short: 'Moxie-Dude', tiny: 'Moxie-Dude' },
  'Westmount Magazine': { key: 'westmount', short: 'Westmount Magazine', tiny: 'Westmount Magazine' },
  'Single Moms with Moxie (Substack)': { key: 'substack', short: 'Single Moms with Moxie', tiny: 'Substack' },
};
const SAME_PIECE = 0.80;        // a passage pasted from a piece scores about 0.84 against it; relatives sit near 0.5
const SHOW = 5;
const MIN_WORDS = 12;
const TARGET_WORDS = 120, MAX_WORDS = 170;

let lib, vectors, norms, dim, ownerOf;
let worker, nextId = 1;
const waiting = new Map();
let runToken = 0;

// ---- small helpers ---------------------------------------------------------
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const plural = (n, one, many) => `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthYear = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

function ago(iso) {
  const then = new Date(iso + 'T12:00:00');
  const months = Math.max(0, Math.floor((Date.now() - then) / (30.44 * 864e5)));
  if (months < 1) return 'this month';
  if (months < 2) return 'last month';
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);   // whole years, never rounded up
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

function ask(message) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
  });
}

// Cut a draft into passages the same way the library was cut: whole
// paragraphs, packed to roughly 120 words.
function passagesOf(text) {
  const paras = text.split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 1);
  const out = [];
  let cur = [], n = 0;
  for (const p of paras) {
    const w = p.split(' ').length;
    if (cur.length && n + w > MAX_WORDS) { out.push(cur.join('\n')); cur = []; n = 0; }
    cur.push(p); n += w;
    if (n >= TARGET_WORDS) { out.push(cur.join('\n')); cur = []; n = 0; }
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

// Closest passage in every piece, for a set of unit query vectors.
function rank(queries, count, skip = -1) {
  const P = lib.pieces.length;
  const best = new Float32Array(P).fill(-1);
  const bestChunk = new Int32Array(P).fill(-1);
  const bestQuery = new Int32Array(P).fill(-1);
  const N = norms.length;
  for (let q = 0; q < count; q++) {
    const off = q * dim;
    for (let r = 0; r < N; r++) {
      let dot = 0;
      const row = r * dim;
      for (let j = 0; j < dim; j++) dot += queries[off + j] * vectors[row + j];
      const cos = dot / norms[r];
      const p = ownerOf[r];
      if (p !== skip && cos > best[p]) { best[p] = cos; bestChunk[p] = r; bestQuery[p] = q; }
    }
  }
  const order = Array.from({ length: P }, (_, i) => i).filter((i) => bestChunk[i] > -1).sort((a, b) => best[b] - best[a]);
  return order.map((i) => ({ piece: i, score: best[i], chunk: bestChunk[i], query: bestQuery[i] }));
}

// A stored piece's own passages as unit float queries (used for "closest pieces").
function pieceQueries(i) {
  const p = lib.pieces[i];
  const out = new Float32Array(p.cn * dim);
  for (let k = 0; k < p.cn; k++) {
    const r = p.c0 + k;
    for (let j = 0; j < dim; j++) out[k * dim + j] = vectors[r * dim + j] / norms[r];
  }
  return out;
}

// ---- rendering -------------------------------------------------------------
function findCard(hit, n, draftPassages, isOpened = false) {
  const p = lib.pieces[hit.piece];
  const o = OUTLET[p.outlet];
  const buried = p.from.length === 0;
  const same = hit.score >= SAME_PIECE;
  const card = el('li', `find ${buried ? 'find--tomb' : 'find--book'}${same ? ' find--same' : ''}`);
  card.style.setProperty('--c', `var(--${o.key}-on-paper)`);
  card.style.setProperty('--n', n);
  card.dataset.score = hit.score.toFixed(3);
  card.append(el('span', 'find__slab'));

  const meta = el('p', 'find__meta');
  meta.append(el('b', '', o.short), ` · ${monthYear(p.date)} · ${ago(p.date)}`);
  const title = el('h3', 'find__title');
  const link = el('a', '', p.title);
  link.href = p.url; link.target = '_blank'; link.rel = 'noopener';
  title.append(link);

  const hers = el('blockquote', 'find__hers');
  hers.cite = p.url;
  const text = lib.chunks[hit.chunk].t;
  for (const para of text.split('\n')) hers.append(el('p', '', para));
  if (text.split(/\s+/).length > 75) {
    hers.dataset.long = 'true';
  }

  const state = el('p', 'find__state');
  if (same) {
    state.append(el('b', '', 'Nearly word for word. '), 'The draft on the desk looks like this piece itself.');
  } else if (buried) {
    state.append(el('b', '', 'In the ground. '), 'Nothing else you have written links to this one.');
  } else {
    state.append(el('b', '', 'On the shelf. '), `Linked from ${plural(p.from.length, 'other piece', 'other pieces')} of yours.`);
  }

  const acts = el('div', 'find__acts');
  const copy = el('button', 'btn btn--lamp', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', () => copyLink(p, copy));
  acts.append(copy);
  if (hers.dataset.long) {
    const more = el('button', 'btn', 'Read the whole passage');
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = hers.dataset.open !== 'true';
      hers.dataset.open = String(open);
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Show less' : 'Read the whole passage';
    });
    acts.append(more);
  }
  if (draftPassages && draftPassages.length > 1 && hit.query > -1) {
    const lead = draftPassages[hit.query].split(/\s+/).slice(0, 6).join(' ');
    acts.append(el('span', 'find__why', `Matches your paragraph that starts “${lead}…”`));
  }
  card.append(meta, title);
  if (isOpened && p.line) {
    // One line of hers, proposed by a local Gemma and kept only because it
    // was found word for word in this piece.
    card.append(el('p', 'find__line', p.line));
    const share = el('button', 'btn', 'Copy line and link');
    share.type = 'button';
    share.addEventListener('click', () => copyLink(p, share, p.line));
    acts.append(share);
    acts.append(el('span', 'find__why', 'Line picked by Gemma 3, kept because it is word for word yours.'));
  }
  card.append(hers, state, acts);
  return card;
}

async function copyLink(p, button, line = null) {
  const safe = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const label = button.textContent;
  const quote = line ? `“${line}” ` : '';
  try {
    // Rich copy: pasted into WordPress or Substack it arrives as a link on the title.
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([`${safe(quote)}<a href="${safe(p.url)}">${safe(p.title)}</a>`], { type: 'text/html' }),
      'text/plain': new Blob([`${quote}${p.url}`], { type: 'text/plain' }),
    })]);
  } catch {
    try { await navigator.clipboard.writeText(`${quote}${p.url}`); } catch { button.textContent = 'Copy failed'; return; }
  }
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = label; }, 1600);
}

function light(pieceIndexes) {
  document.querySelectorAll('.plots .slab--lit').forEach((s) => s.classList.remove('slab--lit'));
  pieceIndexes.forEach((i, n) => {
    const s = document.querySelector(`.plots .slab[data-i="${i}"]`);
    if (s) { s.style.animationDelay = `${n * 70}ms`; s.classList.add('slab--lit'); }
  });
}

function showFinds(titleText, note, cards, lit = []) {
  $('finds-title').textContent = titleText;
  $('finds-note').textContent = note || '';
  $('finds-list').replaceChildren(...cards);
  light(lit);
}

// ---- the desk --------------------------------------------------------------
async function readDraft() {
  const token = ++runToken;
  const text = $('draft').value;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  $('clear').hidden = words === 0;
  $('starters').hidden = words !== 0;

  if (words === 0) {
    return showFinds('Nothing on the desk yet',
      'Write a few sentences on the left. The pieces you have already written on that subject will come up here, each with your own paragraph and a link you can copy.', []);
  }
  if (words < MIN_WORDS) {
    return showFinds('Keep going', `A couple of sentences is enough. ${plural(MIN_WORDS - words, 'more word', 'more words')} and the library starts looking.`, []);
  }
  const passages = passagesOf(text);
  $('finds').setAttribute('aria-busy', 'true');
  $('engine').dataset.state = 'busy';
  let res;
  try {
    res = await ask({ type: 'embed', texts: passages });
  } catch (err) {
    $('engine').dataset.state = 'broken';
    $('engine').textContent = `The reader stopped: ${err.message}`;
    return;
  } finally {
    $('finds').setAttribute('aria-busy', 'false');
  }
  if (token !== runToken) return;   // she kept typing; a newer read is on its way
  setEngineReady(res.ms, passages.length);

  const ranked = rank(res.vectors, passages.length);
  const floor = lib.test.floor;
  const close = ranked.filter((h) => h.score >= floor);
  if (!close.length) {
    return showFinds('Nothing close. This one is new.',
      `None of your ${lib.pieces.length} pieces is near this subject. The cut-off is not a guess: 19 in 20 of the pieces you have published had an earlier piece closer than this draft's best match.`, []);
  }
  const shown = close.slice(0, SHOW);
  const others = close.length - shown.length;
  const title = shown[0].score >= SAME_PIECE
    ? 'This looks like one you already published'
    : `You have been here before, ${shown.length === 1 ? 'once' : `${shown.length} times`}`;
  const note = others > 0 ? `Showing the ${shown.length} closest. ${plural(others, 'more piece clears', 'more pieces clear')} the bar.` : '';
  showFinds(title, note, shown.map((h, n) => findCard(h, n, passages)), shown.map((h) => h.piece));
}

// Click a slab: what is it, and which of her pieces are closest to it?
function openPiece(i) {
  const p = lib.pieces[i];
  if (!p.cn) {
    return showFinds(p.title, `${OUTLET[p.outlet].short}, ${monthYear(p.date)}. This post has no text to read (it was a picture or a video), so there is nothing to match it against.`, []);
  }
  const self = { piece: i, score: 0, chunk: p.c0, query: -1 };
  const near = rank(pieceQueries(i), p.cn, i).filter((h) => h.score >= lib.test.floor).slice(0, 3);
  const note = near.length
    ? `${p.from.length ? 'On the shelf' : 'In the ground'}. Below it: the ${near.length === 1 ? 'piece' : `${near.length} pieces`} closest to it, any of which could link here.`
    : 'Nothing else in the library is close to this one.';
  showFinds(`From ${monthYear(p.date)}`, note, [findCard(self, 0, null, true), ...near.map((h, n) => findCard(h, n + 1))], [i, ...near.map((h) => h.piece)]);
  $('finds').scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function setEngineReady(ms, passages) {
  const e = $('engine');
  e.dataset.state = 'ready';
  const name = lib.meta.model.split('/').pop();
  e.textContent = ms == null
    ? `Reader awake: ${name}, an open model running inside this tab.`
    : `Read ${plural(passages, 'passage', 'passages')} in ${Math.round(ms)} ms with ${name}, inside this tab.`;
}

// ---- the ground ------------------------------------------------------------
function drawGround() {
  const byYear = new Map();
  lib.pieces.forEach((p, i) => {
    const y = p.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(i);
  });
  const plots = $('plots');
  for (const [year, list] of byYear) {
    const block = el('div', 'year');
    const plot = el('div', 'year__plot');
    for (const i of list) {
      const p = lib.pieces[i];
      const s = el('i', `slab ${p.from.length ? 'slab--book' : 'slab--tomb'}`);
      s.dataset.i = i;
      s.style.setProperty('--h', `${Math.round(7 + Math.min(p.words, 1100) / 100)}px`);
      s.style.setProperty('--c', `var(--${OUTLET[p.outlet].key})`);
      plot.append(s);
    }
    block.append(plot, el('span', 'year__label', year));
    plots.append(block);
  }
  const tip = $('tip');
  plots.addEventListener('pointermove', (e) => {
    const s = e.target.closest('.slab');
    if (!s) { tip.hidden = true; return; }
    const p = lib.pieces[+s.dataset.i];
    tip.replaceChildren(el('b', '', p.title), `${OUTLET[p.outlet].short} · ${monthYear(p.date)} · ${p.from.length ? 'on the shelf' : 'in the ground'}`);
    if (p.line) tip.append(el('q', '', p.line));
    tip.hidden = false;
    const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${e.clientY - tip.offsetHeight - 12}px`;
  });
  plots.addEventListener('pointerleave', () => { tip.hidden = true; });
  plots.addEventListener('click', (e) => {
    const s = e.target.closest('.slab');
    if (s) openPiece(+s.dataset.i);
  });

  const counts = lib.stats.outlets;
  $('outlets').replaceChildren(...Object.keys(OUTLET).map((name) => {
    const li = el('li');
    const dot = el('i');
    dot.style.setProperty('--c', `var(--${OUTLET[name].key})`);
    li.append(dot, el('b', '', OUTLET[name].tiny), String(counts[name]));
    return li;
  }));
}

function writeFacts() {
  const s = lib.stats, t = lib.test;
  const years = +s.last_date.slice(0, 4) - +s.first_date.slice(0, 4);
  $('tally').textContent = `${plural(s.pieces, 'piece', 'pieces')} · ${Object.keys(s.outlets).length} outlets · ${years} years`;
  $('buried').textContent = s.pieces_never_linked_any_outlet.toLocaleString('en-CA');
  $('total').textContent = s.pieces.toLocaleString('en-CA');

  const far = t.over_90_days, kw = t.baselines.keyword_search.over_90_days, nw = t.baselines.newest_first.over_90_days;
  $('proof').replaceChildren(
    `On Moxie-Dude you linked back to an earlier post ${s.moxie_backward_links} times, and ${s.moxie_backward_within_30_days} of those were to something from the previous 30 days. You reached back more than 90 days ${far.n} times. Hide each of those ${far.n} links and ask this page to find the post again: it puts yours in its first five `,
    el('b', '', `${far.top5} times out of ${far.n}`),
    `. Keyword search manages ${kw.top5}. Newest-first manages ${nw.top5}. ${far.n} is a small number, so read that as a sign, not a score.`);
  $('limits').textContent =
    `It matches subjects, not jokes, and it cannot tell whether a link would be welcome. It reads passages of about ${TARGET_WORDS} words, so a one-line aside can slip past. It only knows what was public on ${Object.values(OUTLET).map((o) => o.short).join(', ')} up to ${monthYear(s.last_date)}. Unpublished drafts and anything on other sites are not in it.`;
}

// Count requests to any other origin since the page opened, and say the number.
function watchTheDoor() {
  const foreign = () => performance.getEntriesByType('resource')
    .filter((e) => { try { return new URL(e.name).origin !== location.origin; } catch { return false; } }).length;
  const say = () => {
    const n = foreign();
    $('privacy').replaceChildren(
      `Nowhere. The model's files sit beside this page and it runs in the tab, so there is no server to send a draft to. Requests this page has made to any other server since you opened it: `,
      el('b', '', String(n)), '.');
  };
  say();
  setInterval(say, 2000);
}

function starters() {
  const picks = lib.pieces.map((p, i) => ({ p, i })).filter(({ p }) => p.cn > 0).slice(-3).reverse();
  $('starter-row').replaceChildren(...picks.map(({ p }) => {
    const b = el('button', 'btn btn--starter');
    b.append(el('span', '', p.title));
    b.title = `${p.title} (${monthYear(p.date)})`;
    b.type = 'button';
    b.addEventListener('click', () => {
      $('draft').value = lib.chunks[p.c0].t;
      readDraft();
      $('draft').focus();
    });
    return b;
  }));
  $('starters').hidden = false;
}

// ---- start -----------------------------------------------------------------
function theme() {
  const root = document.documentElement, btn = $('theme');
  const paint = () => {
    const dusk = root.dataset.theme === 'dusk';
    $('theme-label').textContent = dusk ? 'Morning' : 'Dusk';
    btn.setAttribute('aria-pressed', String(!dusk));
    btn.setAttribute('aria-label', dusk ? 'Switch to the morning theme' : 'Switch to the dusk theme');
  };
  btn.addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dusk' ? 'morning' : 'dusk';
    try { localStorage.setItem('moxie-theme', root.dataset.theme); } catch { /* private mode */ }
    paint();
  });
  paint();
}

async function start() {
  theme();
  watchTheDoor();
  try {
    const [libRes, vecRes] = await Promise.all([fetch('data/library.json'), fetch('data/vectors.bin')]);
    if (!libRes.ok || !vecRes.ok) throw new Error('the library files are missing');
    lib = await libRes.json();
    vectors = new Int8Array(await vecRes.arrayBuffer());
  } catch (err) {
    $('tally').textContent = 'The library did not open.';
    $('engine').dataset.state = 'broken';
    $('engine').textContent = `Could not load the library: ${err.message}. Run the build steps in the README.`;
    $('draft').disabled = true;
    return;
  }
  dim = lib.meta.dim;
  const N = vectors.length / dim;
  norms = new Float32Array(N);
  for (let r = 0; r < N; r++) {
    let s = 0;
    for (let j = 0; j < dim; j++) s += vectors[r * dim + j] ** 2;
    norms[r] = Math.sqrt(s) || 1;
  }
  ownerOf = new Int32Array(N);
  lib.chunks.forEach((c, r) => { ownerOf[r] = c.p; });

  writeFacts();
  drawGround();
  starters();

  worker = new Worker('embed-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    const w = waiting.get(data.id);
    if (!w) return;
    waiting.delete(data.id);
    data.type === 'error' ? w.reject(new Error(data.message)) : w.resolve(data);
  };
  worker.onerror = (e) => {
    $('engine').dataset.state = 'broken';
    $('engine').textContent = `The reader could not start: ${e.message || 'worker failed to load'}`;
  };

  let timer;
  $('draft').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(readDraft, 550); });
  $('clear').addEventListener('click', () => { $('draft').value = ''; readDraft(); $('draft').focus(); });

  try {
    $('engine').dataset.state = 'busy';
    $('engine').textContent = 'Waking the reader (a 23 MB open model, loaded once)…';
    await ask({ type: 'load', model: lib.meta.model, dtype: lib.meta.dtype, prefix: lib.meta.prefix });
    setEngineReady(null);
    if ($('draft').value.trim()) readDraft();
  } catch (err) {
    $('engine').dataset.state = 'broken';
    $('engine').textContent = `The reader could not start: ${err.message}`;
  }
}

start();
