"""Blind re-find test, graded by the links Mona made by hand.

For every link she wrote from a post S back to an earlier post T, the link is
removed from S (URL and anchor text both), and each method is asked to rank
every post published before S. The score is where T lands.

The ground truth is her own linking decisions between 2011 and 2026. Nothing
in this file decides what counts as a correct answer.

Run:  uv run --python 3.12 --with numpy scripts/eval_links.py
Needs Ollama running locally with the embedding models pulled.
"""
import collections
import datetime
import html
import json
import math
import pathlib
import re
import sys
import urllib.parse
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CACHE = ROOT / "data" / "cache"
EVAL = ROOT / "data" / "eval"
CACHE.mkdir(parents=True, exist_ok=True)
EVAL.mkdir(parents=True, exist_ok=True)

OLLAMA = "http://localhost:11434/api/embed"
# name -> prefix put in front of every chunk. Draft-to-post matching is
# symmetric (both sides are her prose), so both sides get the same prefix.
MODELS = {
    "all-minilm": "",
    "nomic-embed-text": "search_document: ",
    "embeddinggemma": "task: sentence similarity | query: ",
}
CHUNK_WORDS, CHUNK_OVERLAP = 180, 30

posts = json.loads((RAW / "posts.json").read_text(encoding="utf-8"))
posts.sort(key=lambda p: p["date"])
idx = {p["id"]: i for i, p in enumerate(posts)}
edges = [tuple(e) for e in json.loads((RAW / "edges.json").read_text(encoding="utf-8"))]

A_TAG = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)


def is_internal(url):
    host = urllib.parse.urlparse(html.unescape(url)).netloc.lower()
    return (not host and url.startswith("/")) or "moxie-dude" in host or "moxiedude" in host


def plain(rendered, mask_internal):
    if mask_internal:
        # Drop the whole anchor, text included: anchor text often quotes the
        # target's title, which would hand the answer to a keyword method.
        rendered = A_TAG.sub(lambda m: " " if is_internal(m.group(1)) else m.group(2), rendered)
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", rendered, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    return re.sub(r"\s+", " ", text).strip()


def doc_text(p, mask):
    return html.unescape(p["title"]["rendered"]) + ". " + plain(p["content"]["rendered"], mask)


def chunks(text):
    w = text.split()
    if len(w) <= CHUNK_WORDS:
        return [text]
    step = CHUNK_WORDS - CHUNK_OVERLAP
    return [" ".join(w[i:i + CHUNK_WORDS]) for i in range(0, max(len(w) - CHUNK_OVERLAP, 1), step)]


def embed(model, texts):
    out = []
    for i in range(0, len(texts), 16):
        body = json.dumps({"model": model, "input": texts[i:i + 16], "truncate": True}).encode()
        req = urllib.request.Request(OLLAMA, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=600) as r:
            out.extend(json.loads(r.read())["embeddings"])
        print(f"\r  {model}: {min(i + 16, len(texts))}/{len(texts)} chunks", end="", file=sys.stderr)
    print(file=sys.stderr)
    return np.asarray(out, dtype=np.float32)


def doc_vectors(model, prefix, mask):
    tag = f"{model.replace(':', '_')}_{'masked' if mask else 'kept'}"
    f = CACHE / f"{tag}.npz"
    if f.exists():
        z = np.load(f)
        return z["doc"], z["chunk"], z["owner"]
    all_chunks, owner = [], []
    for i, p in enumerate(posts):
        for c in chunks(doc_text(p, mask)):
            all_chunks.append(prefix + c)
            owner.append(i)
    vec = embed(model, all_chunks)
    vec /= np.linalg.norm(vec, axis=1, keepdims=True) + 1e-9
    owner = np.asarray(owner)
    doc = np.zeros((len(posts), vec.shape[1]), dtype=np.float32)
    np.add.at(doc, owner, vec)
    doc /= np.linalg.norm(doc, axis=1, keepdims=True) + 1e-9
    np.savez_compressed(f, doc=doc, chunk=vec, owner=owner)
    return doc, vec, owner


def bm25_scores(mask):
    """Returns row(q) -> BM25 score of every post against post q used as the query."""
    tok = lambda s: re.findall(r"[a-z0-9']+", s.lower())
    docs = [tok(doc_text(p, mask)) for p in posts]
    n = len(docs)
    dl = np.asarray([len(d) for d in docs], dtype=np.float32)
    k1, b = 1.5, 0.75
    norm = k1 * (1 - b + b * dl / dl.mean())
    postings = collections.defaultdict(list)
    for j, d in enumerate(docs):
        for t, f in collections.Counter(d).items():
            postings[t].append((j, f))
    index = {}
    for t, plist in postings.items():
        js = np.asarray([j for j, _ in plist])
        fs = np.asarray([f for _, f in plist], dtype=np.float32)
        idf = math.log(1 + (n - len(plist) + 0.5) / (len(plist) + 0.5))
        index[t] = (js, idf * fs * (k1 + 1) / (fs + norm[js]))

    def row(q):
        scores = np.zeros(n, dtype=np.float32)
        for t in set(docs[q]):
            js, contrib = index[t]
            scores[js] += contrib
        return scores
    return row


def taxonomy_scores():
    sets = [set(p.get("categories", [])) | {-t for t in p.get("tags", [])} for p in posts]
    return lambda q, j: len(sets[q] & sets[j]) / (len(sets[q] | sets[j]) or 1)


# Only links that point back in time: when she wrote S, T already existed.
tests = [(idx[s], idx[t]) for s, t in edges if posts[idx[t]]["date"] < posts[idx[s]]["date"]]
linked_from = collections.defaultdict(set)
for s, t in tests:
    linked_from[s].add(t)

day = lambda p: datetime.date.fromisoformat(p["date"][:10])
gap_days = np.asarray([(day(posts[s]) - day(posts[t])).days for s, t in tests])
# Strata are cut on the calendar gap only, a property of her links that no
# method influences. All of them are reported, including the one where the
# trivial baseline wins.
STRATA = {
    "all links": gap_days >= 0,
    "target within 30 days": gap_days <= 30,
    "target 31 to 90 days back": (gap_days > 30) & (gap_days <= 90),
    "target over 90 days back": gap_days > 90,
    "target over 1 year back": gap_days > 365,
}


def metrics(r):
    return {
        "n": int(len(r)),
        "recall@1": round(float((r <= 1).mean()), 4),
        "recall@5": round(float((r <= 5).mean()), 4),
        "recall@10": round(float((r <= 10).mean()), 4),
        "mrr": round(float((1 / r).mean()), 4),
        "median_rank": int(np.median(r)),
    }


def evaluate(name, score_row):
    """score_row(s) -> scores against every post, higher is closer."""
    ranks, rows = [], {}
    for s, t in tests:
        if s not in rows:
            rows[s] = score_row(s)
        row = rows[s]
        # Candidates: everything published before S, minus S's other real
        # targets so one correct answer cannot push another down.
        cand = [j for j in range(s) if j == t or j not in linked_from[s]]
        better = sum(1 for j in cand if row[j] > row[t])
        ranks.append(better + 1)
    r = np.asarray(ranks)
    res = {"method": name, "strata": {k: metrics(r[m]) for k, m in STRATA.items()}}
    a, far = res["strata"]["all links"], res["strata"]["target over 90 days back"]
    print(f"{name:34s} all n={a['n']} R@5 {a['recall@5']:.3f} | over 90 days n={far['n']} "
          f"R@1 {far['recall@1']:.3f} R@5 {far['recall@5']:.3f} R@10 {far['recall@10']:.3f} "
          f"median rank {far['median_rank']}", flush=True)
    return res, ranks


def passage_scores(vec, owner):
    """Best single passage: the closest pair of chunks between two posts."""
    by_doc = collections.defaultdict(list)
    for c, d in enumerate(owner):
        by_doc[int(d)].append(c)

    def row(s):
        best_per_chunk = (vec[by_doc[s]] @ vec.T).max(axis=0)
        out = np.full(len(posts), -1.0, dtype=np.float32)
        np.maximum.at(out, owner, best_per_chunk)
        return out
    return row


results = []
print(f"{len(tests)} hand-made backward links, {len(posts)} posts. "
      f"Strata sizes: { {k: int(m.sum()) for k, m in STRATA.items()} }\n")

variants = (True, False) if "--kept" in sys.argv else (True,)
for mask in variants:
    label = "link text removed" if mask else "link text kept"
    print(f"--- {label} ---")
    recency = np.arange(len(posts), dtype=np.float32)
    res, _ = evaluate("most recent post first", lambda s: recency)
    results.append({**res, "variant": label})
    tax = taxonomy_scores()
    res, _ = evaluate("shared categories and tags", lambda s: [tax(s, j) for j in range(len(posts))])
    results.append({**res, "variant": label})
    res, ranks = evaluate("BM25 keyword match", bm25_scores(mask))
    results.append({**res, "variant": label})
    all_ranks = {"BM25 keyword match": ranks}
    for model, prefix in MODELS.items():
        doc, vec, owner = doc_vectors(model, prefix, mask)
        sims = doc @ doc.T
        res, ranks = evaluate(f"{model} (whole post)", lambda s: sims[s])
        results.append({**res, "variant": label, "model": model})
        all_ranks[f"{model} (whole post)"] = ranks
        res, ranks = evaluate(f"{model} (best passage)", passage_scores(vec, owner))
        results.append({**res, "variant": label, "model": model})
        all_ranks[f"{model} (best passage)"] = ranks
        (EVAL / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
    if mask:
        (EVAL / "ranks.json").write_text(json.dumps(
            [{"source": posts[s]["link"], "target": posts[t]["link"], "gap_days": int(g),
              "ranks": {m: int(r[i]) for m, r in all_ranks.items()}}
             for i, ((s, t), g) in enumerate(zip(tests, gap_days))], indent=1), encoding="utf-8")
    print()

(EVAL / "results.json").write_text(json.dumps(results, indent=1), encoding="utf-8")
