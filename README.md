# The Moxie Library

Everything my mom has published, in one place, with a desk that points her back at what she
already wrote.

Live: **[moxie-library.vercel.app](https://moxie-library.vercel.app)**

Built for the DEV Hacktoberfest Weekend Challenge: Build for a Friend, 2 to 4 October 2026.

## Who it is for

Mona Andrei writes humour. She has kept [moxie-dude.com](https://www.moxie-dude.com) since 2010,
writes for Westmount Magazine, and has a Substack. In May 2026 she sent me a poster she had made
that said "Don't treat your content like a graveyard. Treat it like a library," and asked for
two things: all of her writing in one place, and a way to be pointed back at what she had
already written when she starts something new.

I built her a social auto-poster that month. It was the wrong thing, and it is not in this repo.
This is the thing she asked for.

## What it does

- **The desk.** She writes or pastes a draft. An open embedding model running inside the browser
  tab reads it and brings back the pieces she has already published on that subject, each with
  her own passage quoted and a link she can copy into WordPress or Substack.
- **The ground.** Every piece is drawn as a slab along the bottom of the window, by year. A piece
  that nothing else of hers links to is a tombstone. A piece that something links to is a book.
  Click one, or type part of its title in the search box, to see it and the pieces closest to it.
- **One line per piece.** Gemma 3 4B, running locally through Ollama, proposes the sentence most
  worth quoting from each piece. A string comparison decides: the line is kept only if it is
  found word for word in that piece. So far it has been asked about 319 pieces and 277 lines
  were kept, 54 of them only after one correction. The run stopped when my laptop's GPU fell
  over, so the other 384 pieces have not been asked yet.
- **It says when there is nothing.** If no piece is close to the draft, the page says the subject
  is new instead of padding the list.

Nothing is written for her. Every suggestion is a real URL and a passage cut from her own text.

## The numbers

All of these come out of `scripts/build_library.py` and `scripts/eval_shipped.py`, and
`scripts/check_claims.py` fails if this file disagrees with the data.

| | |
|---|---|
| Pieces in the library | 710, from 3 outlets, 2010 to 2026 |
| Moxie-Dude | 650 posts, 300,512 words |
| Westmount Magazine | 37 pieces |
| Single Moms with Moxie (Substack) | 23 pieces |
| Words in total | 353,232, cut into 2,809 passages |
| Links she made from one Moxie-Dude post back to an earlier one | 179 |
| Of those, pointing at something from the previous 30 days | 150 |
| Reaching back more than a year | 9 |
| Pieces that nothing else of hers links to | 526 of 710 |

That last pair of rows is the graveyard in her own numbers. Left to memory, a writer links to
what she wrote last week.

## How well it finds things, graded by her

I did not write the answer key. She did, between 2011 and 2026, every time she linked one post
to another.

The test: take a post where she linked back to an earlier one, remove the link and its text,
treat what is left as a draft, and ask for every earlier post ranked by closeness. Then see where
the post she actually linked to lands.

Most of her links are no test of memory, because 150 of 179 point at the previous 30 days and
"newest first" finds them. The 19 that reach back more than 90 days are the ones that matter:

| Method | Her real target in the first five |
|---|---|
| Newest post first | 1 of 19 |
| Keyword search (BM25) | 7 of 19 |
| The model that ships in the page (all-MiniLM-L6-v2, 8-bit) | 9 of 19 |

19 is a small number. Nine against seven is not a result I would defend as a difference; what it
shows is that a 23 MB open model in a browser tab does at least as well as keyword search at the
part she cannot do from memory. I also tried fusing the model with keyword search (10 of 19) and
did not ship it for one extra hit.

These figures are computed from the exact vectors the page loads, not from a different run.

## Why open

- **Her drafts are the input.** The model's files sit beside the page and it runs in the tab, so
  there is no server to send an unpublished draft to. The page counts its own requests to other
  servers and prints the number, which is 0.
- **It works with the network off.** `scripts/check_site.mjs` switches the browser offline and
  asks again.
- **It costs nothing to run.** She is not going to pay a subscription to search her own writing.
- **I could measure the choice.** all-MiniLM, nomic-embed-text and EmbeddingGemma ran against
  her links through Ollama on my laptop before I picked one. On an early version of the test
  they scored 7, 10 and 9 of 19, which is inside the noise. nomic-embed-text then took over a
  second per passage on a CPU in the runtime the page uses; the smallest took 78 ms, so the
  smallest shipped.

## What it cannot do

- It matches subjects, not jokes. It cannot tell whether a link would be welcome.
- It reads passages of about 120 words, so a one-line aside can slip past.
- It only knows what was public on those three outlets when the library was built. Three more
  outlets named on her poster would not let me read them.
- The "nothing close" cut-off is the level that 19 in 20 of her own pieces clear against her
  earlier work. It is a rule taken from her archive, not a guarantee.

## Run it

```
python scripts/fetch_posts.py            # her blog, public WordPress API
python scripts/fetch_outlets.py          # Substack and Westmount Magazine
python scripts/build_library.py          # merge, cut into passages, count
node scripts/build_index.mjs             # embed with the model the page ships
uv run --python 3.12 --with numpy scripts/eval_shipped.py all-minilm-l6-v2-q8
python scripts/ship_index.py all-minilm-l6-v2-q8
python scripts/extract_pull_lines.py     # optional: Gemma 3 via Ollama, resumable
node scripts/vendor.mjs                  # copy the runtime and model beside the page
node scripts/serve.mjs                   # http://localhost:4173
node scripts/check_site.mjs              # the page's promises, checked in a real browser
python scripts/check_claims.py           # this file's numbers, checked against the data
node scripts/capture_assets.mjs          # screenshots and a short video for the post
node scripts/capture_broll.mjs           # 1920x1080 clips for the demo video, into broll/
```

Her writing is her copyright. The fetched text and the built `site/data/` are not in this repo;
the scripts rebuild them from her public pages.

## Open pieces this stands on

[transformers.js](https://github.com/huggingface/transformers.js) and ONNX Runtime Web (Apache-2.0),
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) (Apache-2.0),
[Ollama](https://github.com/ollama/ollama) (MIT) and [Gemma 3](https://ai.google.dev/gemma) for the pull lines and the model comparison,
Bricolage Grotesque and Literata (SIL Open Font License).
