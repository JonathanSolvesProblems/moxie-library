"""Ask a local open model for one quotable line from each piece, and keep it
only if it is word for word hers.

Gemma 3 4B runs on this machine through Ollama. It proposes; a string
comparison decides. A line is accepted only when it can be found in the piece
it came from, and what gets stored is the span cut out of her own text, never
the model's retyping of it. "No line" is a legal answer.

  python scripts/extract_pull_lines.py [--limit N] [--model gemma3:4b]

Resumable: pieces already answered are skipped. Output: data/build/pull_lines.json
"""
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "data" / "build"
OUT = BUILD / "pull_lines.json"
PROMPT = (ROOT / "prompts" / "pull_line.md").read_text(encoding="utf-8")

arg = lambda name, default: sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
MODEL = arg("--model", "gemma3:4b")
LIMIT = int(arg("--limit", "0"))
MIN_WORDS, MAX_WORDS, MAX_INPUT_WORDS = 5, 45, 900

SCHEMA = {
    "type": "object",
    "properties": {"line": {"type": ["string", "null"]}},
    "required": ["line"],
}

pieces = json.loads((BUILD / "pieces.json").read_text(encoding="utf-8"))
chunks = json.loads((BUILD / "chunks.json").read_text(encoding="utf-8"))
# Failed calls are asked again on the next run; answered pieces are not.
done = {r["id"]: r for r in json.loads(OUT.read_text(encoding="utf-8"))
        if not str(r["verdict"]).startswith("error")} if OUT.exists() else {}

# Typography the model tends to flatten. Used for matching only: the stored
# line is always cut from her text with her own characters.
FLAT = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-",
                      "—": "-", "…": "...", "\xa0": " "})


def flatten(s):
    """Returns the flattened string and, for each of its characters, the index in s it came from."""
    out, back = [], []
    prev_space = False
    for i, ch in enumerate(s):
        ch = ch.translate(FLAT)
        for c in ch:
            if c.isspace():
                if prev_space:
                    continue
                c, prev_space = " ", True
            else:
                prev_space = False
            out.append(c)
            back.append(i)
    return "".join(out), back


def find_in(text, offered):
    """The span of `text` that matches `offered`, or None. Exact first, then typography-flattened."""
    offered = offered.strip().strip('"“”').strip()
    if not offered:
        return None, "empty"
    i = text.find(offered)
    if i > -1:
        return text[i:i + len(offered)], "exact"
    flat_text, back = flatten(text)
    flat_offer, _ = flatten(offered)
    flat_offer = flat_offer.strip()
    j = flat_text.find(flat_offer)
    if j > -1 and flat_offer:
        return text[back[j]:back[j + len(flat_offer) - 1] + 1], "typography"
    return None, "not hers"


def ask(text, title, previous=None, problem=None):
    messages = [{"role": "system", "content": PROMPT},
                {"role": "user", "content": f"Title: {title}\n\n<piece>\n{text}\n</piece>"}]
    if previous is not None:
        # One corrective turn: the model sees its own answer and exactly what was wrong with it.
        messages += [{"role": "assistant", "content": json.dumps({"line": previous}, ensure_ascii=False)},
                     {"role": "user", "content": f"That answer cannot be used: {problem} Choose a different "
                                                 "sentence from the piece, copied exactly, or answer null."}]
    body = json.dumps({"model": MODEL, "stream": False, "format": SCHEMA,
                       "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 220},
                       "messages": messages}).encode()
    req = urllib.request.Request("http://localhost:11434/api/chat", data=body,
                                 headers={"Content-Type": "application/json"})
    for attempt in (1, 2, 3):                   # Ollama answers 500 now and then; it passes on a retry
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                reply = json.loads(r.read())
            break
        except urllib.error.URLError:
            if attempt == 3:
                raise
            time.sleep(5 * attempt)
    try:
        return json.loads(reply["message"]["content"]).get("line")
    except json.JSONDecodeError:
        # The model ran on past the length limit and the JSON never closed.
        # That is an answer that cannot be used, not a failed call.
        return CUT_OFF


CUT_OFF = object()


def judge(text, offered):
    """(line cut from her text or None, verdict, problem to show the model or None)"""
    if offered is CUT_OFF:
        return None, "reply cut off", "it ran on past the length limit and was cut off. One sentence only."
    if offered is None:
        return None, "model said none", None
    span, how = find_in(text, offered)
    if span is None:
        return None, how, "it does not appear word for word in the piece."
    words = len(span.split())
    if not MIN_WORDS <= words <= MAX_WORDS:
        return None, f"hers, but {words} words", f"it has {words} words and the line must have {MIN_WORDS} to {MAX_WORDS}."
    return span, how, None


todo = [(i, p) for i, p in enumerate(pieces) if p["cn"] > 0 and p["id"] not in done]
if LIMIT:
    todo = todo[:LIMIT]
t0 = time.time()
for n, (i, p) in enumerate(todo, 1):
    text = "\n".join(chunks[r]["t"] for r in range(p["c0"], p["c0"] + p["cn"]))
    text_in = " ".join(text.split()[:MAX_INPUT_WORDS]) if len(text.split()) > MAX_INPUT_WORDS else text
    rec = {"id": p["id"], "line": None, "offered": None, "verdict": None}
    try:
        offered = ask(text_in, p["title"])
        line, verdict, problem = judge(text, offered)
        if problem:                             # retry fixes a wrong pick; it cannot invent a line that is not there
            shown = None if offered is CUT_OFF else offered
            second = ask(text_in, p["title"], previous=shown or "", problem=problem)
            line2, verdict2, _ = judge(text, second)
            rec["first_offer"], rec["first_verdict"] = shown, verdict
            offered, line, verdict = second, line2, verdict2
        rec["offered"] = None if offered is CUT_OFF else offered
        rec["line"], rec["verdict"] = line, verdict
    except Exception as e:           # a failed call is recorded as a failure, not as "no line"
        rec["verdict"] = f"error: {type(e).__name__}"
    done[p["id"]] = rec
    if n % 10 == 0 or n == len(todo):
        OUT.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=1), encoding="utf-8")
        rate = (time.time() - t0) / n
        print(f"{n}/{len(todo)}  {rate:.1f}s each  last: {rec['verdict']}", flush=True)

OUT.write_text(json.dumps(list(done.values()), ensure_ascii=False, indent=1), encoding="utf-8")
tally = {}
for r in done.values():
    key = r["verdict"] if r["verdict"] in ("exact", "typography", "not hers", "model said none", "reply cut off") else \
        ("error" if str(r["verdict"]).startswith("error") else "wrong length")
    tally[key] = tally.get(key, 0) + 1
print(json.dumps({"model": MODEL, "pieces_answered": len(done), **tally}, indent=1))
