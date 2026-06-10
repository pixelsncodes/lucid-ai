from wiki_store import DEFAULT_ARTICLES_PATH, DEFAULT_INDEX_PATH, rebuild_index


def main():
    result = rebuild_index(DEFAULT_ARTICLES_PATH, DEFAULT_INDEX_PATH)
    print(f"Built Wikipedia index: {result['articles']} articles, {result['chunks']} chunks")
    print(f"Index path: {DEFAULT_INDEX_PATH}")


if __name__ == "__main__":
    main()
