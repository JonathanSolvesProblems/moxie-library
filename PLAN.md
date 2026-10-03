# Plan: The Moxie Library

Entry for the DEV Hacktoberfest Weekend Challenge: Build for a Friend.
Deadline: Monday 5 October 2026, 2:59 AM EDT. Written 2 October, before the first commit.

## Who it is for

Mona Andrei, my mom. Humour blogger, moxie-dude.com since 2010, plus Westmount Magazine and a
Substack. On 24 May 2026 she sent me a poster she had made: "Don't treat your content like a
graveyard. Treat it like a library." She wanted her writing in one place, and a way to be
pointed back at what she had already written. I built her a social auto-poster instead, which
was the wrong thing. This is the right thing.

## The sentence

My mom can paste a draft and get back the pieces she already wrote on that subject, across
three outlets and 16 years, with her own passage quoted and a link ready to copy.

Genre: a library catalogue for one writer, with a desk that remembers.

## What she ends up holding

1. One catalogue of everything she has published: 710 pieces, 3 outlets, 2010 to 2026.
2. For any draft, the earlier pieces worth referring to, each with the passage that matched.
3. A view of which pieces nothing of hers links to, and the closest pieces to link each one from.

Nothing is written for her. Every suggestion is a real URL and a passage quoted verbatim.

## Numbers, and who grades them

All from her published work, re-derivable with `scripts/`:

| Fact | Value | Source |
|---|---|---|
| Pieces on Moxie-Dude | 650 posts, 300,512 words, 7 May 2010 to 7 Aug 2026 | public WordPress API |
| Pieces elsewhere | 37 Westmount Magazine, 23 Substack | public APIs |
| Links she made to her own posts | 192 (179 pointing back in time) | parsed from her posts |
| Of those 179, target written within 30 days | 150 | post dates |
| Links reaching back more than a year | 9 | post dates |
| Posts no other post links to | 490 of 650 | parsed from her posts |

The grader for retrieval is her own linking: hide a link she made, rank every earlier post,
see where her real target lands. On the 19 links that reach back more than 90 days, recency
finds 1 in its top five, keyword search 7, the model that ships 9. n=19 is
small and is stated as such. The real test is Mona judging the suggestions herself.

## Why open

- Her unpublished drafts are the input. The model runs in her browser tab, so a draft never
  leaves her laptop.
- It costs nothing per use, for a writer who is not going to pay a subscription to search her
  own work.
- The comparison the prompt asks for: the same blind test run with a closed embedding API,
  reported whichever way it comes out.

## Demo script (75 seconds)

1. (0:00) Her poster, full frame. "In May my mom sent me this. I built her the wrong thing."
2. (0:08) The stacks: 16 years of slabs. Most are tombstones. "650 posts. 490 of them, nothing
   she wrote links to. In 16 years she linked back more than a year nine times."
3. (0:22) The desk. I paste the opening of a draft she has not published. Three older pieces
   rise out of the graveyard, each with her own paragraph quoted. One is from 2013.
4. (0:40) Wi-Fi off. Type another line. It still answers. "The model is in the tab."
5. (0:48) A subject she has never written about. "Nothing close. That one is new."
6. (0:56) Click a tombstone: the pieces closest to it, one click to copy the link that would
   bring it back onto the shelf.
7. (1:05) Mona using it, and what she said. Final shot is her draft with the links in it.

## Post title (working)

My mom has written 650 blog posts. In 16 years she linked back more than a year nine times.

## Build order

1. Real corpus, real link graph, real blind test. Done 2 October.
2. Index built with the same model and runtime the page ships, and the test re-run on those
   exact vectors.
3. The desk, end to end, in the browser.
4. The stacks.
5. Local Gemma picks a pull line per piece, accepted only if it is a verbatim substring.
6. `check_claims.py`: every number in the README and the post recomputed from the data.
7. Handover to Mona, then the post.

## Open items

- Mona's permission to be named and to show her poster and messages.
- Her text is her copyright. `data/raw/` and the built `site/data/` stay out of git until she
  agrees to what is published.
- A closed-model API key for the comparison.
