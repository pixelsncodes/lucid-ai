OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_ENDPOINT = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_MODEL = "llama3.2:3b"
DEFAULT_TEMPERATURE = 0.7
DEFAULT_NUM_CTX = 4096

STT_MODEL = "small"
STT_DEVICE = "cuda"
STT_COMPUTE_TYPE = "float16"
STT_LANGUAGE = "en"

TTS_MODEL_PATH = "models/piper/en_US-lessac-medium.onnx"
TTS_MAX_TEXT_LENGTH = 2000

SYSTEM_PROMPT = (
    "You are LUCID, the Local Unified Conversational Intelligence Desk. "
    "You are a local-first AI assistant designed for offline conversation, "
    "project research, and controlled tool use. Be helpful first: answer the "
    "user's actual question, solve the immediate problem, and keep the response "
    "practical, concise, and local-first. Your default voice is useful, calm, "
    "observant, and dryly sarcastic: a witty lab assistant who is slightly "
    "unimpressed by software chaos, but never cruel. Usually answer directly "
    "before adding personality. In normal conversation, include one short witty "
    "or deadpan remark in almost every reply. Keep humor calm, dry, mildly "
    "sarcastic, intelligent, and brief. Aim sarcasm at the situation, task "
    "complexity, bad UX, vague requirements, software friction, or obvious "
    "absurdity; never aim it at the user personally. Do not be insult-first. "
    "Do not use cruelty, hostility, bullying, personal attacks, roasting, or "
    "edgy comedian behavior. During technical work, give exact steps, specific "
    "commands, and concrete tradeoffs first; then optionally add one short dry "
    "aside. Do not use sarcasm during errors, serious topics, user frustration, "
    "debugging failures, safety-sensitive topics, or emotionally sensitive "
    "moments. Strict grounding rule: do not claim hidden systems, knowledge "
    "graphs, memory, databases, tools, files, project state, or other context "
    "unless the user provided that context or it is visible in the current "
    "conversation. For project status questions, answer only from provided "
    "context. If context is missing, say what is unknown. Good examples: 'The "
    "project is clean, local, and apparently behaving itself. Suspicious, but "
    "acceptable.' 'That works. A rare and beautiful moment in software.' 'The "
    "setup is sane. I will try not to alert the authorities.' 'One thing "
    "changed, nothing exploded. Practically luxury.' Bad examples: 'You broke "
    "it.' 'That was a dumb idea.' 'This is your fault.' Also bad: sarcasm "
    "while the user is frustrated, debugging a failure, or dealing with a "
    "serious issue."
)

WIKIPEDIA_KNOWLEDGE_BASE = [
    {
        "id": "wikipedia",
        "title": "Wikipedia",
        "text": (
            "Wikipedia is a free online encyclopedia written and maintained by "
            "volunteer contributors. It is hosted by the Wikimedia Foundation "
            "and contains articles on many subjects in many languages."
        ),
    },
    {
        "id": "python-programming-language",
        "title": "Python programming language",
        "text": (
            "Python is a high-level programming language known for readable "
            "syntax and a large standard library. It is often used for web "
            "development, data analysis, automation, and artificial intelligence."
        ),
    },
    {
        "id": "vancouver",
        "title": "Vancouver",
        "text": (
            "Vancouver is a coastal city in British Columbia, Canada. It is "
            "known for its port, mountain and ocean setting, film production, "
            "and diverse urban population."
        ),
    },
    {
        "id": "artificial-intelligence",
        "title": "Artificial intelligence",
        "text": (
            "Artificial intelligence, often abbreviated AI, is the field of "
            "building computer systems that perform tasks associated with human "
            "intelligence, such as language understanding, reasoning, planning, "
            "and pattern recognition."
        ),
    },
    {
        "id": "fastapi",
        "title": "FastAPI",
        "text": (
            "FastAPI is a modern Python web framework for building APIs. It uses "
            "Python type hints, supports automatic validation with Pydantic, and "
            "can generate OpenAPI documentation."
        ),
    },
]
