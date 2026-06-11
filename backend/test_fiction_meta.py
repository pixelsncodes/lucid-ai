"""Unit tests for augment_wikipedia_meta.classify_fiction.

No DB, no dump files — pure classifier logic only.
Category lists are copied verbatim from real dump sample output.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest

from augment_wikipedia_meta import classify_fiction

# ---------------------------------------------------------------------------
# Real-dump category lists
# ---------------------------------------------------------------------------

_ETHEL_SKINNER = [
    "Webarchive template wayback links",
    "Articles with short description",
    "Short description is different from Wikidata",
    "Use dmy dates from February 2016",
    "EastEnders characters",
    "Fictional fortune tellers",
    "Television characters introduced in 1985",
    "Fictional characters with cancer",
    "Fictional suicides",
    "Fictional drug-related deaths",
    "British female characters in soap operas",
    "English female characters in television",
    "Deceased fictional characters",
]

_EMPATH_CHARACTER = [
    "Articles with short description",
    "Short description is different from Wikidata",
    "Articles with topics of unclear notability from April 2023",
    "All articles with topics of unclear notability",
    "Articles lacking reliable references from April 2023",
    "All articles lacking reliable references",
    "Articles with multiple maintenance issues",
    "Converting comics character infoboxes",
    "Comics articles needing issue citations",
    "Articles with unsourced statements from April 2009",
    "Articles with unsourced statements from April 2010",
    "Articles with unsourced statements from January 2015",
    "Characters created by Chris Claremont",
    "Characters created by Sal Buscema",
    "Comics characters introduced in 1984",
    "Fictional empaths",
    "Fictional Spanish people",
    "Marvel Comics mutants",
    "Marvel Comics psychics",
    "Marvel Comics superheroes",
    "Marvel Comics supervillains",
]

_BOTINERAS = [
    "Articles with Spanish-language sources (es)",
    "Articles with short description",
    "Short description is different from Wikidata",
    "Webarchive template wayback links",
    "Telefe telenovelas",
    "Argentine comedy television series",
    "Sports fiction",
    "Argentine LGBTQ-related television shows",
    "Argentine police procedural television series",
    "2009 Argentine television series debuts",
    "2010 Argentine television series endings",
    "Television series by Endemol",
    "Fictional association football television series",
    "2000s Argentine television series",
    "2010s Argentine television series",
]

_WINTER_DREAM = [
    "Wikipedia articles without plot summaries from July 2023",
    "Use mdy dates from February 2026",
    "Articles with short description",
    "Short description is different from Wikidata",
    "2016 films",
    "Template film date with 2 release dates",
    "Rotten Tomatoes ID same as Wikidata",
    "American science fiction films",
    "2016 science fiction films",
    "2016 American films",
    "2016 English-language films",
]

_YOAKE_MAE = [
    "CS1 Japanese-language sources (ja)",
    "CS1 uses Japanese-language script (ja)",
    "Articles with short description",
    "Short description is different from Wikidata",
    "Articles containing Japanese-language text",
    "Manga series",
    "2005 manga",
    "2006 anime television series debuts",
    "All articles with unsourced statements",
    "Articles with unsourced statements from November 2014",
    "Episode list using the default LineColor",
    "Articles with Japanese-language sources (ja)",
    "2005 video games",
    "2006 Japanese novels",
    "2006 Japanese television series endings",
    "Anime composed by Hiroyuki Sawano",
    "Anime television series based on video games",
    "ASCII Media Works manga",
    "Kadokawa Corporation franchises",
    "Bishōjo games",
    "Dengeki Comics",
    "Dengeki Daioh",
    "Eroge",
    "Japan-exclusive video games",
    "Light novels",
    "Manga based on video games",
    "PlayStation 2 games",
    "PlayStation Portable games",
    "Romance anime and manga",
    "Anime and manga set in schools",
    "Seinen manga",
    "Sentai Filmworks",
    "Video games developed in Japan",
    "Visual novels",
    "Windows games",
    "August (company) games",
    "HuneX games",
]

_TOM_PATERSON = [
    "Articles with short description",
    "Short description matches Wikidata",
    "Use dmy dates from April 2022",
    "1954 births",
    "20th-century births",
    "Living people",
    "Scottish comics artists",
    "Scottish humorists",
    "The Dandy people",
    "The Beano people",
    "Dennis the Menace and Gnasher",
    "All stub articles",
    "British comics creator stubs",
]

_FREEMAN_HUBBARD = [
    "Articles with short description",
    "Short description is different from Wikidata",
    "Articles needing additional references from September 2025",
    "All articles needing additional references",
    "American male non-fiction writers",
    "American magazine editors",
    "1894 births",
    "1981 deaths",
    "Writers from New York City",
    "20th-century American male writers",
    "All stub articles",
    "American non-fiction writer stubs",
]

_SAMUEL_BARKER = [
    "Articles with short description",
    "Short description matches Wikidata",
    "Use dmy dates from September 2022",
    "Articles incorporating Cite DNB template",
    "Articles incorporating DNB text with Wikisource reference",
    "1686 births",
    "1759 deaths",
    "Christian Hebraists",
    "People from South Luffenham",
    "18th-century English non-fiction writers",
    "18th-century English male writers",
    "Alumni of Wadham College, Oxford",
    "English male non-fiction writers",
]

_POTTERY_THROW_DOWN = [
    "Webarchive template wayback links",
    "Articles with short description",
    "Short description matches Wikidata",
    "IMDb title ID not in Wikidata",
    "2020s Canadian reality television series",
    "2024 Canadian television series debuts",
    "CBC Television original programming",
    "Arts and crafts television series",
    "Pottery",
    "All stub articles",
    "Canadian non-fiction television series stubs",
    "Canadian television series based on British television series",
    "Canadian pottery",
]

_PASSING_GREAT_RACE = [
    "CS1 maint: bot: original URL status unknown",
    "Articles with short description",
    "Short description is different from Wikidata",
    "Pages using sidebar with the child parameter",
    "Articles lacking reliable references from July 2023",
    "All articles lacking reliable references",
    "Articles containing German-language text",
    "All articles with unsourced statements",
    "Articles with unsourced statements from September 2020",
    "Articles with unsourced statements from March 2018",
    "Articles with unsourced statements from September 2023",
    "Articles with Project Gutenberg links",
    "Articles with LibriVox links",
    "Articles with Internet Archive links",
    "1916 non-fiction books",
    "American non-fiction books",
    "English-language non-fiction books",
    "Books about Europe",
    "Conspiracist books",
    "Eugenics books",
    "Nordicism",
    "Pseudoscience literature",
    "Race and intelligence controversy",
    "Scientific racism",
    "White genocide conspiracy theory",
    "Proto-Nazism",
]

_PEGGY_ANDERSON = [
    "Articles with short description",
    "Short description matches Wikidata",
    "1938 births",
    "2016 deaths",
    "20th-century American non-fiction writers",
    "Augustana College (Illinois) alumni",
    "Writers from Oak Park, Illinois",
    "The Philadelphia Inquirer people",
    "Journalists from Illinois",
    "American women non-fiction writers",
    "20th-century American women journalists",
    "20th-century American journalists",
    "21st-century American women writers",
]

_THOMAS_SEATON = [
    "1684 births",
    "1741 deaths",
    "Alumni of Clare College, Cambridge",
    "Fellows of Clare College, Cambridge",
    "People educated at Stamford School",
    "English religious writers",
    "People from Stamford, Lincolnshire",
    "English male poets",
    "People from West Northamptonshire District",
    "English male non-fiction writers",
    "17th-century Anglican theologians",
    "18th-century Anglican theologians",
    "18th-century English non-fiction writers",
]

# ---------------------------------------------------------------------------
# Acceptance tests — entity
# ---------------------------------------------------------------------------

def test_ethel_skinner_entity():
    assert classify_fiction(_ETHEL_SKINNER) == "entity"


def test_empath_character_entity():
    assert classify_fiction(_EMPATH_CHARACTER) == "entity"


# ---------------------------------------------------------------------------
# Acceptance tests — work
# ---------------------------------------------------------------------------

def test_botineras_work():
    assert classify_fiction(_BOTINERAS) == "work"


def test_winter_dream_work():
    assert classify_fiction(_WINTER_DREAM) == "work"


def test_yoake_mae_work():
    assert classify_fiction(_YOAKE_MAE) == "work"


# ---------------------------------------------------------------------------
# Acceptance tests — none
# ---------------------------------------------------------------------------

def test_tom_paterson_none():
    assert classify_fiction(_TOM_PATERSON) == "none"


def test_freeman_hubbard_none():
    assert classify_fiction(_FREEMAN_HUBBARD) == "none"


def test_samuel_barker_none():
    assert classify_fiction(_SAMUEL_BARKER) == "none"


def test_pottery_throw_down_none():
    assert classify_fiction(_POTTERY_THROW_DOWN) == "none"


def test_passing_great_race_none():
    assert classify_fiction(_PASSING_GREAT_RACE) == "none"


def test_peggy_anderson_none():
    assert classify_fiction(_PEGGY_ANDERSON) == "none"


def test_thomas_seaton_none():
    assert classify_fiction(_THOMAS_SEATON) == "none"


# ---------------------------------------------------------------------------
# Targeted edge-case tests
# ---------------------------------------------------------------------------

def test_american_nonfiction_books_none():
    assert classify_fiction(["American non-fiction books"]) == "none"


def test_scottish_comics_artists_none():
    # "artists" exclusion prevents WORK; no entity triggers
    assert classify_fiction(["Scottish comics artists"]) == "none"


def test_marvel_comics_mutants_entity():
    # broader DC/Marvel fallback catches sub-types outside the whitelist
    assert classify_fiction(["Marvel Comics mutants"]) == "entity"


# ---------------------------------------------------------------------------
# False-positive fix tests (regression guards)
# ---------------------------------------------------------------------------

def test_copyright_case_none():
    # legal/copyright categories are silenced before matching
    assert classify_fiction([
        "Copyright infringement of fictional characters",
        "United States copyright case law",
    ]) == "none"


def test_marvel_comics_people_none():
    # "people" is a creator-exclusion word; "artists" also excluded
    assert classify_fiction([
        "Marvel Comics people",
        "American comics artists",
    ]) == "none"


def test_marvel_comics_mutants_still_entity():
    # ensure the tightening didn't break non-whitelist Marvel entity categories
    assert classify_fiction(["Marvel Comics mutants"]) == "entity"


def test_deceased_fictional_characters_entity():
    # "fictional characters" substring rule must fire even with a prefix word
    assert classify_fiction(["Deceased fictional characters"]) == "entity"
