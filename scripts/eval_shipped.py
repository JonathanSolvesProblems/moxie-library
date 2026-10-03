"""The blind link test, run on the exact vectors the page loads.

For each link Mona made from a Moxie-Dude post back to an earlier one, the
source post (links removed) is treated as a draft, embedded the way the page
embeds a draft, and every earlier Moxie-Dude post is ranked by its closest
passage. The answer key is her own link. Two baselines that use no model run
on the same questions: newest post first, and keyword search (BM25).

  uv run --python 3.12 --with numpy scripts/eval_shipped.py <tag> [<tag> ...]
"""
import collections
import datetime
import json
import math
import pathlib
import re
import sys

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))
pieces = read("data/build/pieces.json")
chunks = read("data/build/chunks.json")
masked = {q["p"]: q["chunks"] for q in read("data/build/eval_queries.json")["queries"]}
day = lambda i: datetime.date.fromisoformat(pieces[i]["date"])
is_moxie = np.asarray([p["outlet"] == "Moxie-Dude" for p in pieces])
owner = np.concatenate([np.full(p["cn"], i) for i, p in enumerate(pieces)])
N = len(pieces)


def metrics(r):
    return {"n": int(len(r)), "top1": int((r <= 1).sum()), "top5": int((r <= 5).sum()),
            "top10": int((r <= 10).sum()), "median_rank": int(np.median(r))}


def strata(ranks, gaps):
    r, g = np.asarray(ranks), np.asarray(gaps)
    return {"all_links": metrics(r), "within_30_days": metrics(r[g <= 30]),
            "over_90_days": metrics(r[g > 90]), "over_1_year": metrics(r[g > 365])}


def rank_all(edges, row_for):
    """row_for(s) -> score of every piece for source s. Returns ranks, gaps, true scores."""
    targets = collections.defaultdict(set)
    for s, t in edges:
        targets[s].add(t)
    ranks, gaps, true_scores, rows = [], [], [], {}
    for s, t in edges:
        if s not in rows:
            rows[s] = row_for(s)
        row = rows[s]
        # Candidates: Moxie-Dude posts published before the source, minus the
        # source's other real targets so one right answer cannot push another down.
        cand = [j for j in range(s) if is_moxie[j] and (j == t or j not in targets[s])]
        ranks.append(1 + sum(1 for j in cand if row[j] > row[t]))
        gaps.append((day(s) - day(t)).days)
        true_scores.append(float(row[t]))
    return ranks, gaps, true_scores


def keyword_rows():
    tok = lambda s: re.findall(r"[a-z0-9']+", s.lower())
    docs = [[] for _ in pieces]
    for c in chunks:
        docs[c["p"]].extend(tok(c["t"]))
    for i, p in enumerate(pieces):
        docs[i].extend(tok(p["title"]))
    dl = np.asarray([len(d) for d in docs], dtype=np.float32)
    k1, b = 1.5, 0.75
    norm = k1 * (1 - b + b * dl / dl.mean())
    postings = collections.defaultdict(list)
    for j, d in enumerate(docs):
        for t, f in collections.Counter(d).items():
            postings[t].append((j, f))
    index = {}
    for t, pl in postings.items():
        js = np.asarray([j for j, _ in pl])
        fs = np.asarray([f for _, f in pl], dtype=np.float32)
        idf = math.log(1 + (N - len(pl) + 0.5) / (len(pl) + 0.5))
        index[t] = (js, idf * fs * (k1 + 1) / (fs + norm[js]))

    def row(s):
        scores = np.zeros(N, dtype=np.float32)
        for t in set(tok(" ".join(masked[s]))):
            if t in index:
                js, contrib = index[t]
                scores[js] += contrib
        return scores
    return row


def run(tag):
    d = ROOT / "data" / "index" / tag
    meta = json.loads((d / "meta.json").read_text())
    vec = np.fromfile(d / "vectors.bin", dtype=np.int8).reshape(-1, meta["dim"]).astype(np.float32)
    vec /= np.linalg.norm(vec, axis=1, keepdims=True) + 1e-9
    ev = json.loads((d / "eval_queries.json").read_text())
    qv = {q["p"]: np.asarray(q["v"], dtype=np.float32) for q in ev["queries"]}
    edges = [tuple(e) for e in ev["edges"]]

    def model_row(s):
        best = (qv[s] @ vec.T).max(axis=0)          # closest draft passage per library passage
        row = np.full(N, -1.0, dtype=np.float32)
        np.maximum.at(row, owner, best)              # closest passage per piece
        return row

    kw_row = keyword_rows()

    def both_row(s):
        # Reciprocal rank fusion with the textbook constant (60), not tuned here.
        out = np.zeros(N, dtype=np.float32)
        for row in (model_row(s), kw_row(s)):
            order = np.argsort(-row, kind="stable")
            pos = np.empty(N, dtype=np.float32)
            pos[order] = np.arange(1, N + 1)
            out += 1.0 / (60.0 + pos)
        return out

    ranks, gaps, true_scores = rank_all(edges, model_row)
    newest = np.arange(N, dtype=np.float32)
    r_new, _, _ = rank_all(edges, lambda s: newest)
    r_kw, _, _ = rank_all(edges, kw_row)
    r_both, _, _ = rank_all(edges, both_row)

    # When does the page say "nothing close"? Her own links cannot set that
    # level: the nearest unrelated passage usually scores higher than the post
    # she actually linked. So the level comes from her archive instead: for
    # every piece that had at least 50 pieces before it, how close was the
    # closest earlier one? 19 in 20 of her pieces clear the 5th percentile, so
    # a draft below it is further from her past work than almost anything she
    # has published.
    nearest_earlier = []
    for i, p in enumerate(pieces):
        if p["cn"] == 0 or i < 50:
            continue
        best = (vec[p["c0"]:p["c0"] + p["cn"]] @ vec.T).max(axis=0)
        row = np.full(N, -1.0, dtype=np.float32)
        np.maximum.at(row, owner, best)
        nearest_earlier.append(float(row[:i].max()))
    floor = float(np.percentile(nearest_earlier, 5))
    res = {
        "model": meta["model"], "dtype": meta["dtype"], "scoring": "closest passage",
        **strata(ranks, gaps),
        "baselines": {"newest_first": strata(r_new, gaps), "keyword_search": strata(r_kw, gaps)},
        # Tried and not shipped: one more hit out of 19 did not justify a second ranker.
        "not_shipped": {"model_plus_keywords_fused": strata(r_both, gaps)},
        "floor": round(floor, 3),
        "floor_rule": "5th percentile of the closeness between each of her pieces and the closest piece "
                      "she had already published (pieces with at least 50 before them)",
        "floor_n": len(nearest_earlier),
        "her_links_closeness_median": round(float(np.median(true_scores)), 3),
        "ms_per_passage_build": meta["ms_per_passage_build"],
    }
    far, kw, nw = res["over_90_days"], res["baselines"]["keyword_search"]["over_90_days"], \
        res["baselines"]["newest_first"]["over_90_days"]
    print(f"{tag}\n  over 90 days back (n={far['n']}): top5 model {far['top5']}, keywords {kw['top5']}, "
          f"newest {nw['top5']} | top1 model {far['top1']}, keywords {kw['top1']} | "
          f"model median rank {far['median_rank']}\n  all {res['all_links']['n']} links: top5 model "
          f"{res['all_links']['top5']}, keywords {res['baselines']['keyword_search']['all_links']['top5']}, "
          f"newest {res['baselines']['newest_first']['all_links']['top5']} | floor {res['floor']} | "
          f"{meta['ms_per_passage_build']} ms/passage")
    out = ROOT / "data" / "eval"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"shipped_{tag}.json").write_text(json.dumps(res, indent=1))
    (out / f"shipped_{tag}_ranks.json").write_text(json.dumps(
        [{"source": pieces[s]["url"], "target": pieces[t]["url"], "gap_days": int(gd), "rank": int(rk),
          "keyword_rank": int(kr)}
         for (s, t), gd, rk, kr in zip(edges, gaps, ranks, r_kw)], indent=1))


for tag in sys.argv[1:]:
    run(tag)
