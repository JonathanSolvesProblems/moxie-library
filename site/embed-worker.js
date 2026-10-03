// The reader. An open-weight embedding model running inside this tab, loaded
// from files that sit next to the page. It is never allowed to fetch a model
// from anywhere else, so a draft has nowhere to go.
import { pipeline, env } from './vendor/transformers.min.js';

env.allowRemoteModels = false;
env.allowLocalModels = true;
// A path, not a full URL: transformers.js 4.3 only checks that the tokenizer
// files exist when the local model path is not an http(s) URL.
env.localModelPath = new URL('./models/', self.location.href).pathname;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', self.location.href).href;
env.backends.onnx.wasm.numThreads = 1;

let extractor = null;
let prefix = '';

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      prefix = data.prefix || '';
      extractor = await pipeline('feature-extraction', data.model, { dtype: data.dtype });
      self.postMessage({ id: data.id, type: 'ready' });
    } else if (data.type === 'embed') {
      const t0 = performance.now();
      const out = await extractor(data.texts.map((t) => prefix + t), { pooling: 'mean', normalize: true });
      const vectors = new Float32Array(out.data);   // copy: the tensor's buffer is reused
      self.postMessage({ id: data.id, type: 'vectors', dims: out.dims, vectors, ms: performance.now() - t0 },
        [vectors.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: data.id, type: 'error', message: String(err && err.message ? err.message : err) });
  }
};
