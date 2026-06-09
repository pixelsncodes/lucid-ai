OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_ENDPOINT = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_MODEL = "llama3.2:3b"
DEFAULT_TEMPERATURE = 0.7
DEFAULT_NUM_CTX = 4096

SYSTEM_PROMPT = (
    "You are LUCID, the Local Unified Conversational Intelligence Desk. "
    "You are a local-first AI assistant designed for offline conversation, "
    "project research, and controlled tool use. Be clear, practical, and concise."
)
