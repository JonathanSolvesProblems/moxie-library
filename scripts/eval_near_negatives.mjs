// Hard negatives for the "Nothing close" rule, prompted by a reader's question.
//
// Each draft below is about a subject her archive never mentions (each topic
// word appears 0 times in the 710 pieces), but is written in her register and
// leans on the words her archive is full of: my kids, my teenager, coffee, wine,
// single mom. A draft like this should get "Nothing close". When it does not,
// the page is suggesting something on vocabulary rather than subject.
//
// Then the mixed case: one on-topic paragraph (the kitchen test from the demo)
// with one of these unrelated paragraphs appended. Does the unrelated paragraph
// push the real matches out of the first five?
//
// Same model, same int8 vectors, same passage scoring and same threshold as the
// shipped page. Drafts are test inputs written by me, not by her.
//
//   node scripts/eval_near_negatives.mjs
import fs from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = './data/models';
const lib = JSON.parse(fs.readFileSync('site/data/library.json', 'utf8'));
const V = new Int8Array(fs.readFileSync('site/data/vectors.bin').buffer.slice(0));
const dim = lib.meta.dim, N = V.length / dim, FLOOR = lib.test.floor, SHOW = 5;
const norms = new Float32Array(N);
for (let r = 0; r < N; r++) { let s = 0; for (let j = 0; j < dim; j++) s += V[r * dim + j] ** 2; norms[r] = Math.sqrt(s); }
const ex = await pipeline('feature-extraction', lib.meta.model, { dtype: lib.meta.dtype });

// Score every piece by its closest passage to any of the draft's paragraphs (as the page does).
async function rank(paragraphs) {
  const out = await ex(paragraphs, { pooling: 'mean', normalize: true });
  const best = new Map();
  for (let q = 0; q < paragraphs.length; q++) {
    for (let r = 0; r < N; r++) {
      let dot = 0; for (let j = 0; j < dim; j++) dot += out.data[q * dim + j] * V[r * dim + j];
      const cos = dot / norms[r], p = lib.chunks[r].p;
      if (!best.has(p) || cos > best.get(p).cos) best.set(p, { cos, q });
    }
  }
  return [...best.entries()].map(([p, v]) => ({ p, ...v })).sort((a, b) => b.cos - a.cos);
}

const NEAR = {
  'drone': 'My teenager got a drone for his birthday and now my mornings start with a buzzing outside the kitchen window. I have not had my coffee yet and there is a camera looking at me.',
  'pickleball': 'My sister talked me into pickleball. As a single mom I do not have time for a new hobby, but apparently it is the thing now, and I spent an hour chasing a plastic ball with holes in it.',
  'jury duty': 'I got a letter saying I have been summoned for jury duty. Two weeks of sitting in a courthouse while my kids text me asking where the clean socks are.',
  'ikea': 'We went to IKEA for one bookshelf. We came home with a lamp, forty tea lights, a plant my daughter named Steve, and no bookshelf. The meatballs were good though.',
  'escape room': 'For my birthday the kids booked an escape room. It turns out my children can work as a team, just never to empty the dishwasher.',
  'beekeeping': 'My neighbour has started keeping bees. Every time I step onto the balcony with a glass of wine there is a small striped audience, and I am told they are friendly.',
  'braces': 'My youngest got braces this week. The orthodontist showed me the bill and then showed me a brochure about payment plans, which felt like a sign.',
  'power outage': 'The power went out for nine hours last night. My teenagers discovered board games, candles, and the fact that I own a deck of cards. It was the best night we have had in months.',
  'bowling': 'We went bowling as a family. I threw three gutter balls in a row and my son filmed every one of them for what he called evidence.',
  'yard sale': 'I finally had the yard sale I have been promising myself for six years. I sold a waffle maker, a box of cables nobody can identify, and somehow bought back a lamp.',
  'trampoline': 'My kids begged for a trampoline. I said yes in a weak moment and now I spend my evenings standing in the yard holding my breath and my coffee.',
  'bake sale': 'The school asked every parent to bring something to the bake sale. I bought cookies at the grocery store, put them on a nice plate and told no one.',
  'snowstorm': 'A snowstorm shut the whole city down today. The kids built a fort on the balcony while I answered emails in my pajamas and pretended it was a normal Tuesday.',
  'tax return': 'I sat down to do my tax return and found receipts from three years ago in a shoebox, next to a drawing my daughter made of me looking very tired.',
};
const KITCHEN = 'I tried a new recipe tonight and set off the smoke alarm twice. The kids ordered pizza before I had finished apologising to the neighbours.';

const nearRows = [];
for (const [topic, text] of Object.entries(NEAR)) {
  const r = await rank([text]);
  const above = r.filter((h) => h.cos >= FLOOR);
  nearRows.push({ topic, best: +r[0].cos.toFixed(3), above: above.length, top: lib.pieces[r[0].p].title });
}

const base = await rank([KITCHEN]);
const baseTop = base.filter((h) => h.cos >= FLOOR).slice(0, SHOW).map((h) => h.p);
const mixedRows = [];
for (const [topic, text] of Object.entries(NEAR)) {
  const r = await rank([KITCHEN, text]);
  const shown = r.filter((h) => h.cos >= FLOOR).slice(0, SHOW);
  const kept = shown.filter((h) => baseTop.includes(h.p)).length;
  const fromNew = shown.filter((h) => h.q === 1).length;
  mixedRows.push({ topic, kept, fromNew });
}

const quiet = nearRows.filter((r) => r.above === 0).length;
const summary = {
  floor: FLOOR,
  near_negatives: nearRows.length,
  answered_nothing_close: quiet,
  suggested_something: nearRows.length - quiet,
  median_best_closeness: nearRows.map((r) => r.best).sort()[Math.floor(nearRows.length / 2)],
  mixed_kitchen_matches_kept_of_5: mixedRows.map((r) => r.kept),
  mixed_slots_taken_by_unrelated_paragraph: mixedRows.map((r) => r.fromNew),
};
console.log('near-topic negatives (best closeness, pieces above the floor, closest title):');
for (const r of nearRows) console.log(`  ${r.topic.padEnd(13)} ${r.best.toFixed(3)}  ${String(r.above).padStart(3)}  ${r.top.slice(0, 70)}`);
console.log('\nmixed drafts (kitchen + unrelated): kitchen pieces kept in the first five / slots taken by the unrelated paragraph');
for (const r of mixedRows) console.log(`  ${r.topic.padEnd(13)} ${r.kept}/5  ${r.fromNew}`);
console.log('\n' + JSON.stringify(summary, null, 1));
fs.writeFileSync('data/eval/near_negatives.json', JSON.stringify({ summary, nearRows, mixedRows }, null, 1));
