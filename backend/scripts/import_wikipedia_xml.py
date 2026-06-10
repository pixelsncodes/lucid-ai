import argparse
import bz2
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from wiki_store import DEFAULT_ARTICLES_PATH, slugify


def open_text(path: Path):
    if path.suffix == ".bz2":
        return bz2.open(path, "rt", encoding="utf-8", errors="replace")
    return path.open("rt", encoding="utf-8", errors="replace")


def strip_markup(text: str) -> str:
    text = re.sub(r"(?is)<ref[^>]*>.*?</ref>", " ", text)
    text = re.sub(r"(?is)<ref[^/]*/>", " ", text)
    text = re.sub(r"(?is)<!--.*?-->", " ", text)

    # Remove common block templates. This is intentionally simple for v1.
    previous = None
    while previous != text:
        previous = text
        text = re.sub(r"\{\{[^{}]*\}\}", " ", text)

    text = re.sub(r"\[\[(?:File|Image):[^\]]+\]\]", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\[\[Category:[^\]]+\]\]", " ", text, flags=re.IGNORECASE)

    # Convert wiki links: [[Target|label]] -> label, [[Target]] -> Target
    text = re.sub(r"\[\[[^|\]]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)

    # Convert external links: [url label] -> label
    text = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", text)
    text = re.sub(r"\[https?://[^\]]+\]", " ", text)

    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"^=+\s*(.*?)\s*=+$", r"\1", text, flags=re.MULTILINE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)

    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            lines.append("")
            continue
        if line.startswith(("{|", "|}", "|-", "|", "!")):
            continue
        lines.append(line)

    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element, name: str) -> str:
    for child in element:
        if local_name(child.tag) == name:
            return child.text or ""
    return ""


def revision_text(page) -> str:
    for child in page:
        if local_name(child.tag) != "revision":
            continue
        for revision_child in child:
            if local_name(revision_child.tag) == "text":
                return revision_child.text or ""
    return ""


def should_skip(title: str, raw_text: str) -> bool:
    if not title or ":" in title:
        return True

    lowered = raw_text.lstrip().lower()
    return lowered.startswith(("#redirect", "{{redirect"))


def import_xml(input_path: Path, output_path: Path, limit: int | None = None) -> dict[str, int]:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    articles = []
    seen_ids = set()

    with open_text(input_path) as stream:
        for event, elem in ET.iterparse(stream, events=("end",)):
            if local_name(elem.tag) != "page":
                continue

            title = child_text(elem, "title").strip()
            raw_text = revision_text(elem)

            if should_skip(title, raw_text):
                elem.clear()
                continue

            text = strip_markup(raw_text)
            if len(text) < 120:
                elem.clear()
                continue

            article_id = slugify(title)
            if article_id in seen_ids:
                article_id = f"{article_id}-{len(seen_ids) + 1}"
            seen_ids.add(article_id)

            articles.append(
                {
                    "id": article_id,
                    "title": title,
                    "text": text,
                }
            )

            elem.clear()

            if limit and len(articles) >= limit:
                break

    output_path.write_text(
        json.dumps(articles, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {"articles": len(articles)}


def main():
    parser = argparse.ArgumentParser(
        description="Import a MediaWiki XML export/dump into local Wikipedia articles.json format."
    )
    parser.add_argument("input", type=Path, help="Path to .xml or .xml.bz2 MediaWiki export/dump")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_ARTICLES_PATH,
        help=f"Output article JSON path. Default: {DEFAULT_ARTICLES_PATH}",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional max number of articles to import for testing.",
    )
    args = parser.parse_args()

    result = import_xml(args.input, args.output, args.limit)
    print(f"Imported Wikipedia XML: {result['articles']} articles")
    print(f"Output path: {args.output}")


if __name__ == "__main__":
    main()
