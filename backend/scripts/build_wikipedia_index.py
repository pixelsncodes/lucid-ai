import argparse
from pathlib import Path

from wiki_store import DEFAULT_ARTICLES_PATH, DEFAULT_INDEX_PATH, rebuild_index


def main():
    parser = argparse.ArgumentParser(
        description="Build the local SQLite FTS Wikipedia index from an articles JSON corpus."
    )
    parser.add_argument(
        "--articles",
        type=Path,
        default=DEFAULT_ARTICLES_PATH,
        help=f"Path to article JSON corpus. Default: {DEFAULT_ARTICLES_PATH}",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=DEFAULT_INDEX_PATH,
        help=f"Path to output SQLite index. Default: {DEFAULT_INDEX_PATH}",
    )
    args = parser.parse_args()

    result = rebuild_index(args.articles, args.index)
    print(f"Built Wikipedia index: {result['articles']} articles, {result['chunks']} chunks")
    print(f"Articles path: {args.articles}")
    print(f"Index path: {args.index}")


if __name__ == "__main__":
    main()
