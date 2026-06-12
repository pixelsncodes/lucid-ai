"""Cross-encoder reranker (ms-marco-MiniLM-L-6-v2, ONNX, fully offline).

Loaded lazily on first call; reuses a single session for the process lifetime.
All model files must be vendored under models/reranker/ — no network calls
at runtime.
"""
import logging
import time
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

_MODEL_DIR = Path(__file__).parent / "models" / "reranker"

_tokenizer = None
_session = None
_loaded = False


def _load_once() -> None:
    global _tokenizer, _session, _loaded
    if _loaded:
        return

    from config import RERANKER_ENABLED  # noqa: PLC0415

    if not RERANKER_ENABLED:
        _loaded = True
        return

    try:
        import onnxruntime as ort  # noqa: PLC0415
        from tokenizers import Tokenizer  # noqa: PLC0415

        tok_path = _MODEL_DIR / "tokenizer.json"
        model_path = _MODEL_DIR / "model.onnx"

        if not tok_path.exists() or not model_path.exists():
            logger.warning("Reranker model files missing at %s — reranker disabled", _MODEL_DIR)
            _loaded = True
            return

        tok = Tokenizer.from_file(str(tok_path))
        tok.enable_truncation(max_length=512)
        tok.enable_padding(pad_token="[PAD]", length=None)

        _tokenizer = tok
        _session = ort.InferenceSession(str(model_path))
        logger.info("Reranker loaded from %s", _MODEL_DIR)
    except Exception:
        logger.exception("Failed to load reranker — reranker disabled")
    finally:
        _loaded = True


def rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Score and sort *candidates* by cross-encoder relevance to *query*.

    Each candidate dict must have a "text" key.  Returns the same list
    (mutated in-place) with a "reranker_score" float added and sorted
    highest-score-first.  When the reranker is disabled or unavailable
    the list is returned unchanged with reranker_score=None on each item.
    """
    _load_once()

    if not candidates:
        return candidates

    if _session is None:
        for c in candidates:
            c["reranker_score"] = None
        return candidates

    t0 = time.perf_counter()
    try:
        texts = [c.get("text", "") for c in candidates]
        pairs = [[query, t] for t in texts]

        encs = _tokenizer.encode_batch(pairs)
        max_len = max(len(e.ids) for e in encs)

        def _pad(seq, pad_val=0):
            return [seq + [pad_val] * (max_len - len(seq))]

        ids = np.array(
            [e.ids + [0] * (max_len - len(e.ids)) for e in encs], dtype=np.int64
        )
        mask = np.array(
            [e.attention_mask + [0] * (max_len - len(e.attention_mask)) for e in encs],
            dtype=np.int64,
        )
        types = np.array(
            [e.type_ids + [0] * (max_len - len(e.type_ids)) for e in encs],
            dtype=np.int64,
        )

        logits = _session.run(
            ["logits"],
            {"input_ids": ids, "attention_mask": mask, "token_type_ids": types},
        )[0]

        for i, c in enumerate(candidates):
            c["reranker_score"] = float(1.0 / (1.0 + np.exp(-logits[i][0])))

        candidates.sort(key=lambda c: c["reranker_score"], reverse=True)

    except Exception:
        logger.exception("Reranker inference error — returning unmodified order")
        for c in candidates:
            c.setdefault("reranker_score", None)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    logger.debug("Reranker: %d candidates in %.1f ms", len(candidates), elapsed_ms)

    return candidates
