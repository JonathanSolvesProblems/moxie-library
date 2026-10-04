"""Gallery preview images for the submission: 3:2 stills from the raw b-roll, in the
order of the demo video, each with one caption the image itself shows.

  python scripts/preview.py

Writes broll/preview/N-name.png and broll/preview/captions.md (captions only, nothing
else, so nothing extra can be pasted with them).
"""
import pathlib
import subprocess

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
BROLL = ROOT / "broll"
OUT = BROLL / "preview"
OUT.mkdir(parents=True, exist_ok=True)

# (name, clip, second, caption), in the order of the demo video.
SHOTS = [
    ("poster", "00b-poster-words", 6.0,
     "My mom's own line, from a poster she made: don't treat your content like a graveyard. Treat it like a library."),
    ("graveyard", "01-ground-glide", 9.4,
     "710 pieces over 16 years, one slab each. 526 are tombstones: nothing else she wrote links to them."),
    ("desk", "02-type-and-find", 15.0,
     "Two sentences on the desk and five of her old pieces come back, each with her own paragraph and a link to copy."),
    ("nothing-close", "05-nothing-close", 10.0,
     "A subject she has never covered gets an honest answer: nothing close, this one is new."),
    ("offline", "06-offline", 13.0,
     "Wi-Fi off and it still answers. The open model runs inside the browser tab, so her draft never leaves her laptop."),
    ("tombstone", "07-open-tombstone", 9.0,
     "Click a tombstone and the piece opens. Gemma 3 picked one line from it, kept only because it is word for word hers."),
    ("copy-link", "04-copy-link", 14.0,
     "Copy the link, paste it into the draft, and a 2014 post is back in circulation."),
    ("receipts", "10-colophon", 16.0,
     "Graded by her own links: on the 19 that reach back over 90 days, it finds 9, keyword search 7. Requests to other servers: 0."),
]

W, H = 1500, 1000
lines = []
for i, (name, clip, at, caption) in enumerate(SHOTS, 1):
    assert len(caption) <= 140, f"{name}: caption is {len(caption)} characters"
    assert "—" not in caption and " – " not in caption, f"{name}: dash connector"
    raw = OUT / f"_{name}.png"
    subprocess.run(["ffmpeg", "-y", "-ss", str(at), "-i", str(BROLL / f"{clip}.mp4"), "-frames:v", "1", str(raw)],
                   check=True, capture_output=True)
    frame = Image.open(raw).convert("RGB")
    # Letterbox 16:9 into 3:2 in the frame's own colour, rather than cropping the sides.
    scale = W / frame.width
    frame = frame.resize((W, round(frame.height * scale)), Image.LANCZOS)
    top, bottom = frame.getpixel((4, 4)), frame.getpixel((4, frame.height - 4))
    canvas = Image.new("RGB", (W, H), top)
    pad = (H - frame.height) // 2
    canvas.paste(Image.new("RGB", (W, H - pad - frame.height), bottom), (0, pad + frame.height))
    canvas.paste(frame, (0, pad))
    out = OUT / f"{i}-{name}.png"
    canvas.save(out, optimize=True)
    raw.unlink()
    size = out.stat().st_size / 1e6
    print(f"{'ok ' if size < 5 else 'BAD'} {out.name:22s} {canvas.size[0]}x{canvas.size[1]} {size:.2f} MB  caption {len(caption)}")
    lines.append(caption)

(OUT / "captions.md").write_text("\n\n".join(lines) + "\n", encoding="utf-8")

# One contact sheet to look at once.
ims = [Image.open(OUT / f"{i}-{n}.png") for i, (n, *_ ) in enumerate(SHOTS, 1)]
sheet = Image.new("RGB", (960 * 2, 640 * 4))
for k, im in enumerate(ims):
    sheet.paste(im.resize((960, 640)), ((k % 2) * 960, (k // 2) * 640))
sheet.save(ROOT / "tmp" / "preview_sheet.png")
