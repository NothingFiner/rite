#!/usr/bin/env python3
"""Regenerate the thesaurus assets (roadmap 5.11).

Two files come out of one run, from the same WordNet release:

    src-tauri/assets/thesaurus.tsv.br            the sense table
    src-tauri/assets/thesaurus-irregulars.tsv.br surface form -> lemma

See below for the row formats.

The thesaurus ships as brotli-compressed TSVs, built offline from English
WordNet 2020 (the maintained successor to Princeton WordNet 3.0). Nothing is
downloaded at app build or run time; this script exists so the assets can be
rebuilt and diffed when a new WordNet release lands.

Why a flat TSV and not WordNet's own dict format: `data.noun` and friends use
hex counts and per-pointer-group token lengths that vary by pointer type, so
hand-parsing them is a bug farm. The `wn` package already implements the format
correctly and exposes the relations with names.

Each row is one SENSE (a word's meaning), tab-separated:

    lemma <TAB> pos <TAB> sense-number <TAB> gloss <TAB> synonyms <TAB> antonyms

- `pos` is WordNet's own code: n (noun), v (verb), a (adjective), s (satellite
  adjective), r (adverb). Rust normalises it for display; the asset keeps the
  raw code so a re-export loses nothing.
- `gloss` is the synset definition, truncated to 120 chars, tabs removed.
- `synonyms` / `antonyms` are comma-separated lemmas. Antonyms live on the
  SENSE in WordNet, not on the word: "light" (adjective, weight) is the antonym
  of "heavy", while "light" (noun, illumination) is not. That is why the row
  unit is the sense.
- Multi-word lemmas ("give up", "New York") are excluded: the context menu only
  takes over for a single word, so they could never be looked up.

The irregular table is one pair per line, `surface <TAB> lemma`. WordNet's own
data only carries lemmas, so "ran" and "mice" appear nowhere in the sense table;
lookup would fall through to the regular English rules and find nothing. Every
word in WordNet, however, lists its lemma followed by its inflected forms, so the
pairs can be mined instead of hand-listed. A pair is kept only when the lemma is one the sense table
actually ships — a pair pointing at a missing entry could never resolve — and
only for single words, since the context menu never takes over a phrase.

Usage:
    pip install wn==0.13 brotli
    python3 scripts/build-thesaurus.py

The first run downloads ewn:2020 into ~/.wn_data (~50 MB, one time).
"""

import pathlib

import wn

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "assets"
ASSET = ASSETS / "thesaurus.tsv.br"
IRREGULAR_ASSET = ASSETS / "thesaurus-irregulars.tsv.br"
GLOSS_LIMIT = 120


def clean(text: str) -> str:
    """One line, no tabs, no leading/trailing space — the row separator is a tab."""
    return " ".join(text.replace("\t", " ").split())


def row_key(row: str):
    lemma, pos, number, *_ = row.split("\t")
    return lemma, pos, int(number), row


def single_word(text: str) -> bool:
    """The context menu only ever takes over one word, so phrases are no use."""
    return " " not in text and "_" not in text and text.replace("-", "").isalpha()


def irregular_pairs(ewn):
    """Every (surface, lemma) pair WordNet records, the lemma itself excluded.

    A word carries its own lemma first and its inflected forms after it, so
    "run" lists run, ran, running. Whatever sits alongside the lemma is a form
    the regular rules cannot always recover, which is exactly the table's job.
    """
    seen = set()
    for word in ewn.words():
        lemma = word.lemma()
        if not single_word(lemma):
            continue
        for form in word.forms():
            if form != lemma and single_word(form):
                seen.add((form, lemma))
    return seen


def main() -> None:
    import brotli  # pip install brotli

    ewn = wn.Wordnet("ewn:2020")
    rows = []
    for word in ewn.words():
        lemma = word.lemma()
        if " " in lemma or "_" in lemma:
            continue
        if not lemma.replace("-", "").isalpha():
            continue
        for number, sense in enumerate(word.senses(), start=1):
            synset = sense.synset()
            synonyms = [other.lemma() for other in synset.words() if other.lemma() != lemma]
            antonyms = [related.word().lemma() for related in sense.get_related("antonym")]
            rows.append(
                "\t".join(
                    (
                        lemma,
                        word.pos,
                        str(number),
                        clean(synset.definition())[:GLOSS_LIMIT],
                        ",".join(dict.fromkeys(synonyms)),
                        ",".join(dict.fromkeys(antonyms)),
                    )
                )
            )

    # Sorted by word and sense number, so a rebuild diffs cleanly instead of
    # churning on iteration order ("c 10" must not sort before "c 2").
    payload = ("\n".join(sorted(rows, key=row_key)) + "\n").encode("utf-8")
    compressed = brotli.compress(payload, quality=11)
    ASSET.write_bytes(compressed)
    print(
        f"{len(rows)} sense rows, {len({row.split(chr(9))[0] for row in rows})} headwords, "
        f"{len(payload) / 1e6:.2f} MB raw -> {len(compressed) / 1e6:.2f} MB brotli"
    )

    headwords = {row.split("\t")[0].lower() for row in rows}
    pairs = {
        (form, lemma)
        for form, lemma in irregular_pairs(ewn)
        if lemma.lower() in headwords
    }
    payload = ("\n".join(f"{form}\t{lemma}" for form, lemma in sorted(pairs)) + "\n").encode("utf-8")
    compressed = brotli.compress(payload, quality=11)
    IRREGULAR_ASSET.write_bytes(compressed)
    print(
        f"{len(pairs)} irregular pairs over {len({form for form, _ in pairs})} forms, "
        f"{len(payload) / 1e3:.1f} KB raw -> {len(compressed) / 1e3:.1f} KB brotli"
    )


if __name__ == "__main__":
    main()
