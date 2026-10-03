"""Pull the pieces Mona published outside her own blog.

Two public sources, both read-only:
  - her Substack, "Single Moms with Moxie" (public archive endpoint)
  - Westmount Magazine (public WordPress REST API), kept only when the piece
    carries her byline. Articles that are merely about her are dropped and
    listed, so the filter can be checked by eye.

Output goes to data/raw/, which stays out of git.
"""
import html
import json
import pathlib
import re
import time
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "raw"
OUT.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (family archive; read-only)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode("utf-8")), r.headers


def strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


# --- Substack -------------------------------------------------------------
substack, offset = [], 0
while True:
    page, _ = get(f"https://moxiemona.substack.com/api/v1/archive?sort=new&limit=50&offset={offset}")
    if not page:
        break
    substack.extend(page)
    offset += len(page)
    if len(page) < 50:
        break
    time.sleep(0.5)

pieces = []
for p in substack:
    body = p.get("body_html") or ""
    if p.get("audience") != "everyone" or len(strip(body).split()) < 50:
        # Paywalled or truncated in the archive listing: fetch the post itself.
        try:
            full, _ = get(f"https://moxiemona.substack.com/api/v1/posts/{p['slug']}")
            body = full.get("body_html") or body
            time.sleep(0.5)
        except Exception as e:
            print("  could not fetch full body for", p["slug"], e)
    pieces.append({
        "outlet": "Single Moms with Moxie (Substack)",
        "id": f"substack-{p['id']}",
        "date": p["post_date"][:19],
        "url": p["canonical_url"],
        "title": p["title"],
        "html": body,
    })
(OUT / "substack.json").write_text(json.dumps(pieces, ensure_ascii=False), encoding="utf-8")
words = [len(strip(x["html"]).split()) for x in pieces]
print(f"Substack: {len(pieces)} pieces, {min(x['date'] for x in pieces)[:10]} to "
      f"{max(x['date'] for x in pieces)[:10]}, {sum(words)} words, shortest {min(words)}")

# --- Westmount Magazine ---------------------------------------------------
found, page_no = [], 1
while True:
    page, headers = get("https://www.westmountmag.ca/wp-json/wp/v2/posts?search=Mona%20Andrei"
                        f"&per_page=100&page={page_no}&_fields=id,date,link,title,content,excerpt")
    found.extend(page)
    if page_no >= int(headers.get("X-WP-TotalPages", "1")):
        break
    page_no += 1
    time.sleep(0.5)

BYLINE = re.compile(r"\bby\s+mona\s+andrei\b", re.I)
kept, dropped = [], []
for p in found:
    title = strip(p["title"]["rendered"])
    # Her own pieces open with the byline. Year-end roundups and articles
    # about her mention it far down the page, so position is the test.
    m = BYLINE.search(strip(p["content"]["rendered"]))
    if m and m.start() < 200:
        kept.append({
            "outlet": "Westmount Magazine",
            "id": f"westmount-{p['id']}",
            "date": p["date"],
            "url": p["link"],
            "title": title,
            "html": p["content"]["rendered"],
        })
    else:
        dropped.append(f"{p['date'][:10]}  {title}")
(OUT / "westmount.json").write_text(json.dumps(kept, ensure_ascii=False), encoding="utf-8")
print(f"Westmount Magazine: {len(kept)} pieces with her byline, "
      f"{min(x['date'] for x in kept)[:10]} to {max(x['date'] for x in kept)[:10]}, "
      f"{sum(len(strip(x['html']).split()) for x in kept)} words")
print(f"  dropped {len(dropped)} search hits without her byline:")
for d in dropped:
    print("   ", d)
