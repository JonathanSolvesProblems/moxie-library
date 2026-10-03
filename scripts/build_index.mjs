// Embed every passage with the same open model, weights and runtime the page
// uses (transformers.js + ONNX), so the vectors the browser compares against
// are produced the same way as the vector it makes from her draft.
//
//   node scripts/build_index.mjs --model Xenova/all-MiniLM-L6-v2 [--prefix "..."] [--dtype q8]
//
// Writes data/index/<tag>/. The page only gets an index through ship_index.py,
// which refuses one that has not been through the blind test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@huggingface/transformers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const MODEL = arg('model', 'Xenova/all-MiniLM-L6-v2');
const DTYPE = arg('dtype', 'q8');
const PREFIX = arg('prefix', '');
const TAG = MODEL.split('/').pop().toLowerCase() + '-' + DTYPE;
const BATCH = 8;

env.cacheDir = path.join(ROOT, 'data', 'models');   // model files stay out of git

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'build', f), 'utf8'));
const pieces = read('pieces.json');
const chunks = read('chunks.json');
const evalSet = read('eval_queries.json');

console.log(`model ${MODEL} (${DTYPE}), ${chunks.length} passages`);
const extractor = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });

async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => PREFIX + t);
    const res = await extractor(batch, { pooling: 'mean', normalize: true });
    const [n, d] = res.dims;
    for (let r = 0; r < n; r++) out.push(res.data.slice(r * d, (r + 1) * d));
    if ((i / BATCH) % 25 === 0) process.stdout.write(`\r  ${Math.min(i + BATCH, texts.length)}/${texts.length}`);
  }
  process.stdout.write('\n');
  return out;
}

// A passage is embedded with its piece's title in front, the way a reader
// meets it. The title is not part of the text shown back to her.
const t0 = performance.now();
const vecs = await embed(chunks.map((c) => `${pieces[c.p].title}. ${c.t}`));
const msPerPassage = (performance.now() - t0) / chunks.length;
const dim = vecs[0].length;
console.log(`dim ${dim}, ${msPerPassage.toFixed(1)} ms per passage on this machine's CPU`);

// int8 is enough for ranking and keeps the download small.
const q = new Int8Array(vecs.length * dim);
vecs.forEach((v, i) => { for (let j = 0; j < dim; j++) q[i * dim + j] = Math.max(-127, Math.min(127, Math.round(v[j] * 127))); });

const outDir = path.join(ROOT, 'data', 'index', TAG);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'vectors.bin'), Buffer.from(q.buffer));
const meta = {
  model: MODEL, dtype: DTYPE, prefix: PREFIX, dim, passages: chunks.length,
  ms_per_passage_build: Math.round(msPerPassage * 10) / 10,
};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));

// Blind-test queries, embedded exactly like a draft would be in the page.
const queries = [];
for (const qy of evalSet.queries) queries.push({ p: qy.p, v: (await embed(qy.chunks)).map((v) => Array.from(v)) });
fs.writeFileSync(path.join(outDir, 'eval_queries.json'), JSON.stringify({ queries, edges: evalSet.edges }));

console.log(`wrote data/index/${TAG}`);
