#!/usr/bin/env python3
"""Regenerate src-tauri/assets/thesaurus.tsv.br (roadmap 5.11).

The thesaurus ships as one brotli-compressed TSV, built offline from English
WordNet 2020 (the maintained successor to Princeton WordNet 3.0). Nothing is
downloaded at app build or run time; this script exists so the asset can be
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

Usage:
    pip install wn==0.13
    python3 scripts/build-thesaurus.py

The first run downloads ewn:2020 into ~/.wn_data (~50 MB, one time).
"""

import pathlib

import wn

ASSET = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "assets" / "thesaurus.tsv.br"
GLOSS_LIMIT = 120


def clean(text: str) -> str:
    """One line, no tabs, no leading/trailing space — the row separator is a tab."""
    return " ".join(text.replace("\t", " ").split())


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
            antonyms = [relation.lemma() for relation in sense.get_related("antonym")]
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

    payload = ("\n".join(rows) + "\n").encode("utf-8")
    compressed = brotli.compress(payload, quality=11)
    ASSET.write_bytes(compressed)
    print(
        f"{len(rows)} sense rows, {len({row.split(chr(9))[0] for row in rows})} headwords, "
        f"{len(payload) / 1e6:.2f} MB raw -> {len(compressed) / 1e6:.2f} MB brotli"
    )


if __name__ == "__main__":
    main()
