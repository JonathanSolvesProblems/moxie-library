"""Assemble site/data/ from one built index.

  python scripts/ship_index.py <tag>

site/data/library.json carries the pieces, her passages, the corpus numbers
and the blind-test result for the model that is actually shipped, so the page
never shows a number that came from a different model.
"""
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
tag = sys.argv[1]
idx = ROOT / "data" / "index" / tag
build = ROOT / "data" / "build"
site = ROOT / "site" / "data"
site.mkdir(parents=True, exist_ok=True)

read = lambda p: json.loads(p.read_text(encoding="utf-8"))
meta = read(idx / "meta.json")
test_file = ROOT / "data" / "eval" / f"shipped_{tag}.json"
if not test_file.exists():
    sys.exit(f"Run scripts/eval_shipped.py {tag} first: the page will not ship an untested model.")

edges = read(build / "edges.json")
pieces = read(build / "pieces.json")
linked_from = {}
for s, t in edges:
    linked_from.setdefault(t, []).append(s)
for i, p in enumerate(pieces):
    p["from"] = linked_from.get(i, [])

# Pull lines, if the Gemma step has run. Only lines that passed the
# word-for-word check carry a "line"; everything else stays without one.
lines_file = build / "pull_lines.json"
lines = None
if lines_file.exists():
    recs = read(lines_file)
    kept = {r["id"]: r["line"] for r in recs if r.get("line")}
    for p in pieces:
        if p["id"] in kept:
            p["line"] = kept[p["id"]]
    lines = {
        "model": "gemma3:4b",
        "asked": len(recs),
        "kept": len(kept),
        "not_hers": sum(1 for r in recs if r["verdict"] == "not hers"),
        "wrong_length": sum(1 for r in recs if str(r["verdict"]).startswith("hers, but")),
        "model_said_none": sum(1 for r in recs if r["verdict"] == "model said none"),
        "failed_calls": sum(1 for r in recs if str(r["verdict"]).startswith("error")),
    }

library = {
    "meta": meta,
    "lines": lines,
    "stats": read(build / "stats.json"),
    "test": read(test_file),
    "pieces": pieces,
    "chunks": read(build / "chunks.json"),
}
(site / "library.json").write_text(json.dumps(library, ensure_ascii=False), encoding="utf-8")
shutil.copyfile(idx / "vectors.bin", site / "vectors.bin")
print(f"shipped {tag}: {len(pieces)} pieces, {meta['passages']} passages, "
      f"library.json {(site / 'library.json').stat().st_size / 1e6:.1f} MB, "
      f"vectors.bin {(site / 'vectors.bin').stat().st_size / 1e6:.2f} MB")
