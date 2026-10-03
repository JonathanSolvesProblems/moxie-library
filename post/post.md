---
title: My mom has published 710 pieces in 16 years. Nothing she wrote links to 526 of them.
published: false
tags: devchallenge, weekendchallenge, hf26challenge, opensource
---

*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01).*

## What I Built

In May my mom sent me a poster she had made. A graveyard at dusk, six tombstones, and on each tombstone the title of something she had written and where it ran. Across the top: "Don't treat your content like a graveyard. Treat it like a library." Under it she typed, "Remember the app idea I had?"

My mom is Mona Andrei. She writes humour. She has kept a blog called [Moxie-Dude](https://www.moxie-dude.com) since 2010, she writes a column for Westmount Magazine, she has a Substack for single moms, and she wrote a book called Superwoman. She wanted two things: everything she has written in one place, and something that would point her back at what she already wrote when she sits down to write something new.

I built her a social media scheduler. It had a landing page and a logo and it ran on sample data. She found a product online that already did that, and texted me: "Found it. I will find the hole."

This weekend I built what she asked for the first time. It is called **The Moxie Library**, and it is a single web page.

![The desk with two test sentences on the left, and her 2014 piece about cooking red meat coming back on the right. Sixteen years of slabs run along the bottom.](https://moxie-library.vercel.app/press/found.png)

On the left is a sheet of paper. She writes a draft there, or pastes one. When she pauses, the page looks through everything she has published and brings back the pieces on the same subject. Each one comes with her own paragraph quoted, where it ran, how many years ago, and a button that copies a link she can paste straight into WordPress or Substack.

Along the bottom is the ground. Every piece she has published is drawn there as a small slab, by year. If nothing else she wrote links to it, it is a tombstone. If something does, it is a book on a shelf. A tombstone and a book spine turn out to be the same shape, which is the whole design.

Nothing on the page is written for her. Every suggestion is a real link and a passage cut out of her own text. If she writes about something she has never covered, it says "Nothing close. This one is new." and shows nothing.

### Her graveyard, counted

I pulled everything public: 650 posts from her blog, 37 columns from Westmount Magazine and 23 pieces from her Substack. That is 710 pieces and 353,232 words.

Then I counted the links she had made by hand from one of her pieces to another.

- **526 of the 710** have nothing of hers pointing at them.
- On her blog she linked back to an earlier post 179 times. **150 of those** pointed at something from the previous 30 days.
- In 16 years she reached back **more than a year 9 times**.

Left to memory, a writer links to what she wrote last week. The poster was right, and it was more right than she knew: three of the six pieces on her tombstones are in the library, and all three are in the ground.

![Sixteen years of her writing drawn as slabs by year. The grey round-topped ones are tombstones: pieces nothing else of hers links to.](https://moxie-library.vercel.app/press/ground.png)

## Demo

Live page: **[moxie-library.vercel.app](https://moxie-library.vercel.app)**

My mom said yes to being the example, and to the page quoting her. Her text is hers, every quoted passage links back to where she published it, and the page asks search engines not to index it, so it does not compete with her own blog.

![A short recording: two sentences typed, five of her pieces arriving, then a subject she has never covered](https://moxie-library.vercel.app/press/demo.gif)

Things to try:

1. Type a couple of sentences about a kitchen disaster. In the recording I typed "I tried a new recipe tonight and set off the smoke alarm twice. The kids ordered pizza before I had finished apologising to the neighbours." Those are my test sentences, not hers. What comes back is hers: five pieces written between 2013 and 2016, starting with the one about why she should never try to cook red meat again.
2. Type something a humour writer in Montreal has probably never covered. I used the Treaty of Westphalia. You get "Nothing close."
3. Turn your Wi-Fi off and type another line. It still answers.
4. Click any tombstone along the bottom, or type part of a title in the search box. You get that piece and the three closest to it, any of which could link to it.

## Code

{% github JonathanSolvesProblems/moxie-library %}

Her writing is her copyright, so her text is not in the repo. The scripts rebuild the library from her public pages.

## How I Built It

**Getting 16 years of writing.** Her blog is WordPress, and WordPress has a public REST API, so 650 posts came down in seven requests. Substack has a public archive endpoint. Westmount Magazine is also WordPress, but searching it for her name returns articles about her as well as by her, so I kept a piece only when "By Mona Andrei" appears in its first 200 characters. That dropped five, including the one announcing she had won Humour Blogger of the Year.

**Cutting it into passages.** Each piece is cut on paragraph boundaries into passages of about 120 words. 2,809 of them.

**The model.** [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2), an open-weight embedding model, 23 MB at 8-bit. It runs through [transformers.js](https://github.com/huggingface/transformers.js) on WebAssembly, in a web worker, inside her browser tab. The whole index of her writing is 2,809 vectors of 384 numbers each, stored as one byte per number: 1.08 MB.

When she pauses typing, the draft is cut into passages the same way, each one is embedded in the tab, and every piece is scored by its closest passage. That is all the matching there is.

**I picked the model by testing three on her own links.** I ran all-MiniLM, nomic-embed-text and EmbeddingGemma through Ollama on my laptop's GPU. On an early version of the test described below they scored 7, 10 and 9 of 19, which is inside the noise. Then I tried the best scorer, nomic-embed-text, in the runtime the page uses: over a second per passage on a CPU. The smallest took 78 ms. So the smallest shipped.

**A second open model picks one line per piece.** Gemma 3 4B, running locally through Ollama, reads each piece and proposes the one sentence most worth quoting. Then a string comparison decides. The line is kept only if it can be found word for word in the piece, and what gets stored is the span cut from her text, not Gemma's retyping of it. So far it has been asked about 319 pieces. 277 lines were kept, 54 of them only after one correction. 42 were thrown out: 9 were not word for word hers, 8 were the wrong length, 23 ran on past the limit, and twice it said there was no line, which is an allowed answer. The other 384 pieces have not been asked yet, because my laptop's GPU fell over halfway through the run. The page shows a line only where one was kept.

**One bug worth passing on.** transformers.js 4.3 loaded the model from local files and then failed with `this.tokenizer is not a function`. It checks whether tokenizer files exist only when the local model path is not a full URL. I had passed `new URL('./models/', location).href`. Passing `.pathname` instead fixed it.

### How well does it find things? She graded it.

I did not write the answer key. She did, between 2011 and 2026, every time she linked one post to another.

The test: take a post where she linked back to an earlier one. Remove the link and its text. Treat what is left as a draft. Ask for every earlier post, ranked. See where the one she actually linked to lands.

Most of her links are no test at all, because 150 of 179 point at last month and "show the newest post" finds them. The ones that matter are the 19 that reach back more than 90 days.

| Method | Her real target in the first five |
|---|---|
| Newest post first | 1 of 19 |
| Keyword search (BM25) | 7 of 19 |
| The model in the page | 9 of 19 |

Nineteen is a small number, and nine against seven is not a difference I would defend. What it shows is that a 23 MB open model in a browser tab does at least as well as keyword search at the one thing she cannot do from memory. I also tried fusing the two (10 of 19) and did not ship a second ranker for one extra hit.

Those numbers come from the exact vectors the page loads, not a separate run.

### Two things I got wrong on the way

My first rule for "nothing close" was a similarity level that nine in ten of her real links cleared. It was useless. The nearest unrelated passage usually scores higher than the post she actually linked, so the page would never have said no. The rule that shipped comes from her archive instead: for every piece she has published, how close was the closest earlier one? 19 in 20 clear a certain level. A draft below that level is further from her past work than almost anything she has ever published, and that is when the page says the subject is new.

The second one is the first paragraph of this post. I built the scheduler.

### Checks that fail out loud

`check_site.mjs` opens the page in real Chromium and checks what the page promises: the model loads from local files, a passage of hers finds its own piece first, the quoted passage is word for word from the library, the Treaty of Westphalia gets "Nothing close", the page still answers with the network switched off, any piece can be opened from the keyboard, and not one request leaves the page's own origin. 14 checks.

`check_claims.py` reads every number in the README and in this post and compares it with the data. On its first run it caught a stale word count in my own plan.

## Why Does Open Innovation Matter?

Her drafts are the input. An unpublished draft is the one thing a writer does not hand to a server she does not control, and here there is no server to hand it to. The model's files sit beside the page. The page counts its own requests to any other server and prints the number at the bottom. It is 0.

It works on a plane. After the first load the page needs nothing.

It costs nothing to run, which matters more than it sounds. My mom is not going to pay a monthly fee to search her own writing, and I am not going to pay per request so that she can.

And I could choose the model by measuring it against her, on my own laptop, in an afternoon. Three open models, her 19 links, pick the one that is small enough for her browser.

Where would closed have been better? Probably on raw accuracy. I did not run a closed embedding model against her links, so I am not going to claim open won that. What open did that closed could not do is run inside her tab, offline, with her draft going nowhere.

### What she said

Nothing yet. She said yes to being the example, but she has not sat down with it, so there is no quote here. I would rather leave that blank than write one for her, which is also the rule the page follows.

### What it cannot do

It matches subjects, not jokes, and it cannot tell whether a link would be welcome. It reads passages of about 120 words, so a one-line aside can slip past. Three of the outlets on her poster are not in it yet, because their sites would not let me read them. And 19 links is a small test.

## Prize Categories

**Best Use of Gemma.** Gemma 3 4B runs locally through Ollama and proposes one pull line per piece, and a word-for-word check decides which ones are kept. EmbeddingGemma was one of the three models I tested against her links. To be clear about the rest: the model that does the matching in the page is all-MiniLM-L6-v2, not Gemma.

*Fonts are Bricolage Grotesque and Literata, both SIL Open Font License. The teal and the gold are the ones on her blog.*
