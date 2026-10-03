// Copy the open-source runtime and the open-weight model into site/, so the
// page asks no other server for anything once it is loaded.
//
//   node scripts/vendor.mjs [model id]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.argv[2] ?? 'Xenova/all-MiniLM-L6-v2';
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return fs.statSync(to).size;
};

let bytes = 0;
const vendor = path.join(ROOT, 'site', 'vendor');
bytes += copy(path.join(ROOT, 'node_modules/@huggingface/transformers/dist/transformers.min.js'),
  path.join(vendor, 'transformers.min.js'));
const ort = path.join(ROOT, 'node_modules/onnxruntime-web/dist');
for (const f of fs.readdirSync(ort)) {
  // transformers.js 4.3 asks for the asyncify build and no other.
  if (/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f)) bytes += copy(path.join(ort, f), path.join(vendor, f));
}

const src = path.join(ROOT, 'data', 'models', MODEL);
const dst = path.join(ROOT, 'site', 'models', MODEL);
for (const f of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']) {
  bytes += copy(path.join(src, f), path.join(dst, f));
}
console.log(`vendored runtime and ${MODEL} into site/ (${(bytes / 1e6).toFixed(1)} MB)`);
