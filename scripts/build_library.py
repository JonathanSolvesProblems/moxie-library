"""Merge everything Mona has published into one library.

Reads data/raw/ (Moxie-Dude, Substack, Westmount Magazine) and writes
data/build/:
  pieces.json        one record per piece, with the links between her pieces
  chunks.json        each piece cut into passages of her own prose
  eval_queries.json  for the blind test only: source posts with her links removed
  stats.json         every corpus number quoted anywhere, computed here once

Nothing in here calls a model.
"""
import collections
import datetime
import html
import json
import pathlib
import re
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "build"
OUT.mkdir(parents=True, exist_ok=True)

MAX_WORDS, TARGET_WORDS = 170, 120   # passage size, small enough for a 256-token model

load = lambda name: json.loads((RAW / name).read_text(encoding="utf-8"))
cat_names = {c["id"]: html.unescape(c["name"]) for c in load("categories.json")}

pieces = []
for p in load("posts.json"):
    pieces.append({
        "id": f"moxie-{p['id']}", "outlet": "Moxie-Dude", "date": p["date"], "url": p["link"],
        "title": html.unescape(re.sub(r"<[^>]+>", "", p["title"]["rendered"])).strip(),
        "html": p["content"]["rendered"],
        "cats": [cat_names[c] for c in p.get("categories", []) if c in cat_names],
    })
for name in ("substack.json", "westmount.json"):
    for p in load(name):
        pieces.append({**p, "title": html.unescape(p["title"]).strip(), "cats": []})
pieces.sort(key=lambda p: (p["date"], p["id"]))

# --- text ------------------------------------------------------------------
A_TAG = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.I | re.S)
BLOCK_END = re.compile(r"</(p|div|li|h[1-6]|blockquote|figure|figcaption|tr|ul|ol)>|<br\s*/?>", re.I)
JUNK = re.compile(
    r"<(script|style|figure|form|button|iframe)[^>]*>.*?</\1>"            # not prose
    r"|<div[^>]*class=\"[^\"]*(subscription-widget|button-wrapper|sharedaddy|wp-caption)[^\"]*\".*?</div>"
    r"|\[/?caption[^\]]*\]", re.I | re.S)


def norm_url(u):
    pu = urllib.parse.urlparse(html.unescape(u).strip())
    host = pu.netloc.lower().removeprefix("www.")
    return host + pu.path.rstrip("/").lower()


by_url = {norm_url(p["url"]): i for i, p in enumerate(pieces)}
moxie_slug = {p["url"].rstrip("/").rsplit("/", 1)[-1].lower(): i
              for i, p in enumerate(pieces) if p["outlet"] == "Moxie-Dude"}


def resolve(href, source_outlet):
    """Index of the piece a link points to, or None."""
    href = html.unescape(href).strip()
    if href.startswith("/") and source_outlet == "Moxie-Dude":
        href = "https://www.moxie-dude.com" + href
    key = norm_url(href)
    if key in by_url:
        return by_url[key]
    if key.startswith("moxie-dude.com") and not re.search(r"/(wp-content|category|tag|author|page)/", key):
        return moxie_slug.get(key.rsplit("/", 1)[-1])   # permalinks that changed date
    return None


def paragraphs(markup, drop_links_to=None):
    """Her prose as a list of paragraphs. drop_links_to removes whole anchors
    (text included) that resolve to one of her own pieces, for the blind test."""
    if drop_links_to is not None:
        markup = A_TAG.sub(lambda m: " " if drop_links_to(m.group(1)) else m.group(2), markup)
    markup = JUNK.sub(" ", markup)
    markup = BLOCK_END.sub("\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", " ", markup)).replace("\xa0", " ")
    out = []
    for line in text.split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if len(line) > 1:
            out.append(line)
    return out


def passages(paras):
    """Pack whole paragraphs into passages of about TARGET_WORDS words."""
    units = []
    for para in paras:
        words = para.split()
        if len(words) <= MAX_WORDS:
            units.append(para)
        else:  # a very long paragraph: cut at sentence ends
            cur = []
            for sent in re.split(r"(?<=[.!?…])\s+", para):
                if cur and len(" ".join(cur + [sent]).split()) > MAX_WORDS:
                    units.append(" ".join(cur))
                    cur = []
                cur.append(sent)
            if cur:
                units.append(" ".join(cur))
    out, cur, n = [], [], 0
    for u in units:
        w = len(u.split())
        if cur and n + w > MAX_WORDS:
            out.append("\n".join(cur))
            cur, n = [], 0
        cur.append(u)
        n += w
        if n >= TARGET_WORDS:
            out.append("\n".join(cur))
            cur, n = [], 0
    if cur:
        # A short tail reads better attached to the passage before it.
        if out and n < 40 and len(out[-1].split()) + n <= MAX_WORDS + 40:
            out[-1] += "\n" + "\n".join(cur)
        else:
            out.append("\n".join(cur))
    return out


# --- links between her own pieces -------------------------------------------
edges = set()
for i, p in enumerate(pieces):
    for href, _ in A_TAG.findall(p["html"]):
        j = resolve(href, p["outlet"])
        if j is not None and j != i:
            edges.add((i, j))
inbound, outbound = collections.Counter(), collections.Counter()
for s, t in edges:
    outbound[s] += 1
    inbound[t] += 1

chunks, records = [], []
for i, p in enumerate(pieces):
    paras = paragraphs(p["html"])
    ps = passages(paras)
    first = len(chunks)
    chunks.extend({"p": i, "t": t} for t in ps)
    records.append({
        "id": p["id"], "outlet": p["outlet"], "date": p["date"][:10], "url": p["url"],
        "title": p["title"], "cats": p["cats"], "words": sum(len(x.split()) for x in paras),
        "in": inbound[i], "out": outbound[i], "c0": first, "cn": len(ps),
    })

day = lambda i: datetime.date.fromisoformat(records[i]["date"])
moxie = [i for i, r in enumerate(records) if r["outlet"] == "Moxie-Dude"]
mm = [(s, t) for s, t in edges
      if records[s]["outlet"] == records[t]["outlet"] == "Moxie-Dude"]
back = sorted((s, t) for s, t in mm if pieces[t]["date"] < pieces[s]["date"])
gaps = [(day(s) - day(t)).days for s, t in back]

# Blind-test queries: each source post with every link to her own work removed.
eval_queries = []
for s in sorted({s for s, _ in back}):
    is_own = lambda href, s=s: resolve(href, pieces[s]["outlet"]) is not None
    masked = passages([records[s]["title"] + "."] + paragraphs(pieces[s]["html"], drop_links_to=is_own))
    eval_queries.append({"p": s, "chunks": masked})

by_outlet = collections.Counter(r["outlet"] for r in records)
stats = {
    "pieces": len(records),
    "outlets": dict(by_outlet),
    "first_date": records[0]["date"], "last_date": records[-1]["date"],
    "words": sum(r["words"] for r in records),
    "passages": len(chunks),
    "moxie_posts": len(moxie),
    "moxie_words": sum(records[i]["words"] for i in moxie),
    "moxie_first": min(records[i]["date"] for i in moxie),
    "moxie_last": max(records[i]["date"] for i in moxie),
    "moxie_peak_year": collections.Counter(records[i]["date"][:4] for i in moxie).most_common(1)[0],
    "moxie_own_links": len(mm),
    "moxie_backward_links": len(back),
    "moxie_backward_within_30_days": sum(g <= 30 for g in gaps),
    "moxie_backward_over_90_days": sum(g > 90 for g in gaps),
    "moxie_backward_over_1_year": sum(g > 365 for g in gaps),
    "moxie_posts_that_link_to_her_own": len({s for s, _ in mm}),
    "moxie_posts_never_linked": sum(1 for i in moxie if not any(t == i for _, t in mm)),
    "all_links_between_her_pieces": len(edges),
    "cross_outlet_links": sum(1 for s, t in edges if records[s]["outlet"] != records[t]["outlet"]),
    "pieces_never_linked_any_outlet": sum(1 for i in range(len(records)) if inbound[i] == 0),
}

dump = lambda name, obj: (OUT / name).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
dump("pieces.json", records)
dump("chunks.json", chunks)
dump("edges.json", sorted(edges))
dump("eval_queries.json", {"queries": eval_queries, "edges": back})
(OUT / "stats.json").write_text(json.dumps(stats, indent=1, ensure_ascii=False), encoding="utf-8")

print(json.dumps(stats, indent=1, ensure_ascii=False))
lens = [len(c["t"].split()) for c in chunks]
print(f"passage words: min {min(lens)}, median {sorted(lens)[len(lens) // 2]}, max {max(lens)}")
