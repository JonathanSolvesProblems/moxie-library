"""Phase 0 measurement: pull every public post from moxie-dude.com and count
the links Mona made by hand to her own earlier posts.

Read-only, public WordPress REST API. Output goes to data/raw/, which stays
out of git because the posts are her copyrighted writing.
"""
import collections
import html
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

BASE = "https://www.moxie-dude.com/wp-json/wp/v2"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
FIELDS = "id,date,slug,link,title,content,excerpt,categories,tags"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "phase0-measure/1.0 (family archive)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8")), r.headers


def fetch_all(kind, fields):
    items, page = [], 1
    while True:
        data, headers = get(f"{BASE}/{kind}?per_page=100&page={page}&_fields={fields}")
        items.extend(data)
        if page >= int(headers.get("X-WP-TotalPages", "1")):
            return items
        page += 1
        time.sleep(0.5)


posts_file = OUT / "posts.json"
if posts_file.exists():
    posts = json.loads(posts_file.read_text(encoding="utf-8"))
else:
    posts = fetch_all("posts", FIELDS)
    posts_file.write_text(json.dumps(posts, ensure_ascii=False), encoding="utf-8")
    (OUT / "categories.json").write_text(
        json.dumps(fetch_all("categories", "id,name,count"), ensure_ascii=False), encoding="utf-8")
    (OUT / "tags.json").write_text(
        json.dumps(fetch_all("tags", "id,name,count"), ensure_ascii=False), encoding="utf-8")

print("posts fetched:", len(posts))


def text_of(rendered):
    return html.unescape(re.sub(r"<[^>]+>", " ", rendered))


def norm_path(url):
    p = urllib.parse.urlparse(url)
    return p.path.rstrip("/").lower()


by_path = {norm_path(p["link"]): p["id"] for p in posts}
by_slug = {p["slug"].lower(): p["id"] for p in posts}

words = [len(text_of(p["content"]["rendered"]).split()) for p in posts]
per_year = collections.Counter(p["date"][:4] for p in posts)

href = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\']', re.I)
hosts = collections.Counter()
edges = set()            # (source id, target id), resolved to a real post
unresolved = collections.Counter()
for p in posts:
    for u in href.findall(p["content"]["rendered"]):
        u = html.unescape(u).strip()
        pu = urllib.parse.urlparse(u)
        host = pu.netloc.lower().removeprefix("www.")
        if host:
            hosts[host] += 1
        if host and "moxie-dude" not in host and "moxiedude" not in host:
            continue
        if not host and not u.startswith("/"):
            continue
        if re.search(r"/wp-content/|/category/|/tag/|/author/|/page/|\.(jpg|jpeg|png|gif|pdf)$", pu.path, re.I):
            continue
        path = pu.path.rstrip("/").lower()
        target = by_path.get(path) or by_slug.get(path.split("/")[-1])
        if target is None:
            if path:
                unresolved[path] += 1
            continue
        if target != p["id"]:
            edges.add((p["id"], target))

sources = {s for s, _ in edges}
targets = {t for _, t in edges}
date_of = {p["id"]: p["date"] for p in posts}
backward = sum(1 for s, t in edges if date_of[t] < date_of[s])

print("date range:", min(p["date"] for p in posts)[:10], "to", max(p["date"] for p in posts)[:10])
print("total words:", sum(words), "| median words/post:", sorted(words)[len(words) // 2])
print("posts per year:", dict(sorted(per_year.items())))
print("hand-made links to her own posts (unique source->target pairs):", len(edges))
print("  of which point back to an earlier post:", backward)
print("posts that link to at least one of her own posts:", len(sources), f"({len(sources) / len(posts):.1%})")
print("posts never linked from any other post:", len(posts) - len(targets))
print("internal-looking links that match no current post:", sum(unresolved.values()), "| distinct:", len(unresolved))
print("  examples:", list(unresolved.most_common(8)))
print("top linked hosts:", hosts.most_common(25))

(OUT / "edges.json").write_text(json.dumps(sorted(edges)), encoding="utf-8")
