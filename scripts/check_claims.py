"""Fail if the prose and the data disagree.

Every number quoted in the README, the plan, the post and the page is listed
here next to where it comes from. The script recomputes nothing by hand: it
reads the files the pipeline wrote, finds each claim in the documents, and
exits non-zero when a figure is wrong, when a required claim has gone missing,
or when a retired figure has crept back in.

  python scripts/check_claims.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
read = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))
SHIPPED = "all-minilm-l6-v2-q8"

stats = read("data/build/stats.json")
test = read(f"data/eval/shipped_{SHIPPED}.json")
ollama = {(r["method"], r["variant"]): r["strata"]["target over 90 days back"]
          for r in read("data/eval/results.json")}
ollama_top5 = sorted(round(ollama[(f"{m} (best passage)", "link text removed")]["recall@5"] *
                           ollama[(f"{m} (best passage)", "link text removed")]["n"])
                     for m in ("all-minilm", "nomic-embed-text", "embeddinggemma"))
meta = read(f"data/index/{SHIPPED}/meta.json") if (ROOT / f"data/index/{SHIPPED}/meta.json").exists() else None

far = test["over_90_days"]
kw = test["baselines"]["keyword_search"]["over_90_days"]
new = test["baselines"]["newest_first"]["over_90_days"]
fused = test["not_shipped"]["model_plus_keywords_fused"]["over_90_days"]
n = lambda v: f"{v:,}"

# (label, expected text, pattern). The pattern matches the claim wherever it is
# phrased this way; its one capture group must equal the expected text.
CLAIMS = [
    # "asked about N pieces" and "the other N pieces" belong to the Gemma claims below.
    ("pieces in the library", n(stats["pieces"]),
     r"Pieces in the library \| (\d+)|(?<!about )(?<!other )\b(\d{3}) pieces\b"),
    ("pieces, 'of 710' form", n(stats["pieces"]), r"\bof (?:your |her |the )?(7\d\d)\b(?! Moxie)"),
    ("never linked, all outlets", n(stats["pieces_never_linked_any_outlet"]), r"\b(\d{3}) of (?:your |her |the )?710\b"),
    ("Moxie-Dude posts", n(stats["moxie_posts"]), r"\b(\d{3}) (?:blog )?posts\b"),
    ("never linked, prose", n(stats["pieces_never_linked_any_outlet"]), r"links to (\d{3}) of them"),
    ("Moxie-Dude never linked", n(stats["moxie_posts_never_linked"]), r"\b(\d{3}) of (?:the 650|650)\b"),
    ("Moxie-Dude words", n(stats["moxie_words"]), r"650 posts, ([\d,]+) words"),
    ("Westmount pieces", n(stats["outlets"]["Westmount Magazine"]),
     r"Westmount Magazine \| (\d+) pieces|(?<!\d)(\d+) Westmount Magazine|(\d+) columns from Westmount"),
    ("Substack pieces", n(stats["outlets"]["Single Moms with Moxie (Substack)"]),
     r"\(Substack\) \| (\d+) pieces|(?<!\d)(\d+) Substack|(\d+) pieces from her Substack"),
    ("total words", n(stats["words"]), r"Words in total \| ([\d,]*\d)|pieces and ([\d,]*\d) words"),
    ("passages", n(stats["passages"]),
     r"cut into ([\d,]+) passages|120 words\. ([\d,]+) of them|([\d,]+) vectors"),
    ("backward links", n(stats["moxie_backward_links"]),
     r"back to an earlier one \| (\d+)|back to an earlier post (\d+) times"),
    ("backward links, '150 of N' form", n(stats["moxie_backward_links"]), r"\b150 of (\d+)\b"),
    ("within 30 days", n(stats["moxie_backward_within_30_days"]), r"\b(\d+) of (?:179|those)\b"),
    ("within 30 days, table", n(stats["moxie_backward_within_30_days"]), r"previous 30 days \| (\d+)"),
    ("over a year", n(stats["moxie_backward_over_1_year"]),
     r"more than a year \| (\d+)|more than a year (\d+) times"),
    ("long-range links", n(far["n"]), r"\b[Tt]he (\d+) that reach back more than 90 days"),
    ("long-range n", n(far["n"]), r"(?:first|\(BM25\)|8-bit\)|in the page) \| \d+ of (\d+)"),
    ("newest first", n(new["top5"]), r"Newest post first \| (\d+) of"),
    ("keyword search", n(kw["top5"]), r"Keyword search \(BM25\) \| (\d+) of"),
    ("shipped model", n(far["top5"]), r"(?:8-bit\)|model in the page) \| (\d+) of"),
    ("fused, not shipped", n(fused["top5"]), r"(?:keyword search|fusing the two) \((\d+) of 19\)"),
    ("requests to fetch her blog", n(-(-stats["moxie_posts"] // 100)), r"came down in (\w+) requests"),
]
WORDS = {"seven": "7", "twice": "2", "once": "1"}          # numbers the prose spells out

# The Gemma pull-line step, counted by ship_index.py from the extraction log.
lines_file = ROOT / "data" / "build" / "pull_lines_summary.json"
if lines_file.exists():
    lines = json.loads(lines_file.read_text(encoding="utf-8"))
    CLAIMS += [
        ("Gemma: pieces asked", n(lines["asked"]), r"asked about (\d+) pieces"),
        ("Gemma: lines kept", n(lines["kept"]), r"(\d+) lines were kept|(\d+) verified lines"),
        ("Gemma: kept after a correction", n(lines["kept_after_one_correction"]), r"(\d+) of them only after one correction"),
        ("Gemma: thrown out", n(lines["asked"] - lines["kept"]), r"(\d+) were thrown out"),
        ("Gemma: not hers", n(lines["not_hers"]), r"(\d+) were not word for word hers"),
        ("Gemma: wrong length", n(lines["wrong_length"]), r"(\d+) were the wrong length"),
        ("Gemma: cut off", n(lines["cut_off"]), r"(\d+) ran on past the limit"),
        ("Gemma: said none", n(lines["model_said_none"]), r"(\w+) it said there was no line"),
        ("Gemma: no answer from the server", n(lines["not_yet_asked"]), r"other (\d+) pieces"),
    ]
REQUIRED_IN_README = {"pieces in the library", "never linked, all outlets", "Moxie-Dude posts", "backward links",
                      "within 30 days, table", "over a year", "newest first", "keyword search", "shipped model"}
# Figures that were true of an earlier build and must not come back.
RETIRED = ["302,423", "0.286", "recall@5 0.", "110.7 MB"]

DOCS = ["README.md", "PLAN.md"] + sorted(str(p.relative_to(ROOT)) for p in (ROOT / "post").glob("*.md"))
problems, seen = [], set()
for doc in DOCS:
    path = ROOT / doc
    if not path.exists():
        continue
    text = path.read_text(encoding="utf-8")
    for label, expected, pattern in CLAIMS:
        for m in re.finditer(pattern, text, flags=re.M):
            got = next(g for g in m.groups() if g is not None)
            got = WORDS.get(got, got)
            if got != expected:
                line = text.count("\n", 0, m.start()) + 1
                problems.append(f"{doc}:{line}  {label}: says {got}, data says {expected}  ->  \"{m.group(0)}\"")
            elif doc == "README.md":
                seen.add(label)
    for old in RETIRED:
        if old in text:
            problems.append(f"{doc}  retired figure is back: {old}")
for label in sorted(REQUIRED_IN_README - seen):
    problems.append(f"README.md  required claim not found: {label}")

# Claims that need more than one number, checked in every document.
by_model = [round(ollama[(f"{m} (best passage)", "link text removed")]["recall@5"] *
                  ollama[(f"{m} (best passage)", "link text removed")]["n"])
            for m in ("all-minilm", "nomic-embed-text", "embeddinggemma")]
browser_checks = len(re.findall(r"^\s*check\('(?!run completed)", (ROOT / "scripts/check_site.mjs").read_text(encoding="utf-8"), flags=re.M))
index_file = ROOT / "data" / "index" / SHIPPED / "vectors.bin"
for doc in DOCS:
    if not (ROOT / doc).exists():
        continue
    text = (ROOT / doc).read_text(encoding="utf-8")
    # Listed in the order all-MiniLM, nomic-embed-text, EmbeddingGemma.
    for m in re.finditer(r"scored (\d+), (\d+) and (\d+) of 19", text):
        if list(map(int, m.groups())) != by_model:
            problems.append(f"{doc}  model comparison says {m.groups()}, data says {by_model} (MiniLM, nomic, EmbeddingGemma)")
    if meta:
        for m in re.finditer(r"smallest\s+(?:was|took) (\d+) ms", text):
            if int(m.group(1)) != round(meta["ms_per_passage_build"]):
                problems.append(f"{doc}  build speed says {m.group(1)} ms, data says {meta['ms_per_passage_build']}")
    for m in re.finditer(r"(\d+) checks", text):
        if int(m.group(1)) != browser_checks:
            problems.append(f"{doc}  says {m.group(1)} browser checks, check_site.mjs has {browser_checks}")
    if index_file.exists():
        for m in re.finditer(r"number: ([\d.]+) MB", text):
            if m.group(1) != f"{index_file.stat().st_size / 1e6:.2f}":
                problems.append(f"{doc}  index size says {m.group(1)} MB, file is {index_file.stat().st_size / 1e6:.2f} MB")

# What the page ships must be what was tested.
site = ROOT / "site" / "data" / "library.json"
if site.exists():
    lib = json.loads(site.read_text(encoding="utf-8"))
    if lib["stats"] != stats:
        problems.append("site/data/library.json  corpus numbers differ from data/build/stats.json: re-run ship_index.py")
    if lib["test"] != test:
        problems.append("site/data/library.json  test result differs from the shipped model's eval: re-run ship_index.py")
    model_file = ROOT / "site" / "models" / lib["meta"]["model"] / "onnx" / "model_quantized.onnx"
    if model_file.exists() and round(model_file.stat().st_size / 1e6) != 23:
        problems.append(f"page says the model is 23 MB, file is {model_file.stat().st_size / 1e6:.1f} MB")
    # Pull lines: each must be cut from the piece it is attached to.
    for i, p in enumerate(lib["pieces"]):
        if p.get("line"):
            body = "\n".join(c["t"] for c in lib["chunks"][p["c0"]:p["c0"] + p["cn"]])
            if p["line"] not in body:
                problems.append(f"pull line for {p['id']} is not in her text")

if problems:
    print(f"{len(problems)} problem(s):")
    for p in problems:
        print("  " + p)
    sys.exit(1)
print(f"claims hold: {len(CLAIMS)} patterns checked across {len([d for d in DOCS if (ROOT / d).exists()])} documents, "
      f"all {len(REQUIRED_IN_README)} required claims present in the README")
