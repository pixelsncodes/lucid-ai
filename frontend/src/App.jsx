import { useEffect, useState } from 'react'
import './App.css'

const features = ['Offline LLM', 'Voice Chat', 'Local RAG']
const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_NUM_CTX = 4096
const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 2
const MIN_NUM_CTX = 512
const MAX_NUM_CTX = 32000
const MAX_HISTORY_MESSAGES = 12
const MAX_HISTORY_CONTENT_LENGTH = 2000

const clampFiniteNumber = (value, min, max, fallback) => {
  const nextValue = Number(value)

  if (!Number.isFinite(nextValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, nextValue))
}

const clampContextSize = (value) =>
  Math.round(clampFiniteNumber(value, MIN_NUM_CTX, MAX_NUM_CTX, DEFAULT_NUM_CTX))

function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [isSending, setIsSending] = useState(false)
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [modelStatus, setModelStatus] = useState('loading')
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE)
  const [numCtx, setNumCtx] = useState(DEFAULT_NUM_CTX)

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((response) => {
        setBackendStatus(response.ok ? 'online' : 'offline')
      })
      .catch(() => {
        setBackendStatus('offline')
      })
  }, [])

  useEffect(() => {
    fetch('http://localhost:8000/models')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Models request failed')
        }

        return response.json()
      })
      .then((data) => {
        const availableModels = Array.isArray(data.models) ? data.models : []
        const defaultModel = data.default_model || availableModels[0] || ''

        setModels(availableModels)
        setSelectedModel(defaultModel)
        setModelStatus(availableModels.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => {
        setModels([])
        setSelectedModel('')
        setModelStatus('offline')
      })
  }, [])

  const handleSendMessage = async (event) => {
    event.preventDefault()

    const trimmedMessage = message.trim()
    const trimmedModel = selectedModel.trim()
    const safeTemperature = clampFiniteNumber(
      temperature,
      MIN_TEMPERATURE,
      MAX_TEMPERATURE,
      DEFAULT_TEMPERATURE,
    )
    const safeNumCtx = clampContextSize(numCtx)

    if (!trimmedMessage || !trimmedModel || isSending) {
      return
    }

    const history = chatMessages
      .filter((chatMessage) => ['user', 'assistant'].includes(chatMessage.role))
      .map((chatMessage) => ({
        role: chatMessage.role,
        content: chatMessage.text.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH),
      }))
      .filter((chatMessage) => chatMessage.content)
      .slice(-MAX_HISTORY_MESSAGES)
    const userMessage = { role: 'user', text: trimmedMessage }
    setChatMessages((currentMessages) => [...currentMessages, userMessage])
    setMessage('')
    setIsSending(true)

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedMessage,
          history,
          model: trimmedModel,
          temperature: safeTemperature,
          num_ctx: safeNumCtx,
        }),
      })

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      const data = await response.json()
      setChatMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', text: data.reply || 'No reply received.' },
      ])
    } catch {
      setChatMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', text: 'Unable to reach the chat backend.' },
      ])
    } finally {
      setIsSending(false)
    }
  }

  return (
    <main className="landing">
      <section className="hero" aria-labelledby="lucid-title">
        <p className="eyebrow">Private AI workspace</p>
        <h1 id="lucid-title">LUCID</h1>
        <p className="subtitle">Local Unified Conversational Intelligence Desk</p>
        <p className={`backend-status backend-status--${backendStatus}`} aria-live="polite">
          Backend: {backendStatus}
        </p>

        <div className="feature-grid" aria-label="LUCID features">
          {features.map((feature) => (
            <article className="feature-card" key={feature}>
              <span className="feature-dot" aria-hidden="true" />
              <h2>{feature}</h2>
            </article>
          ))}
        </div>

        <section className="chat-panel" aria-label="LUCID chat">
          <div className="settings-row">
            <label className="setting-field" htmlFor="model-select">
              <span>Model</span>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={modelStatus !== 'ready'}
              >
                {models.length > 0 ? (
                  models.map((model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {modelStatus === 'loading' ? 'Loading models' : 'No models found'}
                  </option>
                )}
              </select>
            </label>

            <label className="setting-field" htmlFor="temperature-input">
              <span>Temperature</span>
              <input
                id="temperature-input"
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(event) =>
                  setTemperature(
                    clampFiniteNumber(
                      event.target.value,
                      MIN_TEMPERATURE,
                      MAX_TEMPERATURE,
                      DEFAULT_TEMPERATURE,
                    ),
                  )
                }
              />
            </label>

            <label className="setting-field" htmlFor="context-input">
              <span>Context</span>
              <input
                id="context-input"
                type="number"
                min="512"
                max="32000"
                step="512"
                value={numCtx}
                onChange={(event) => setNumCtx(clampContextSize(event.target.value))}
              />
            </label>
          </div>

          <div className="chat-area" aria-live="polite">
            {chatMessages.length === 0 ? (
              <p className="chat-empty">Start a local conversation.</p>
            ) : (
              chatMessages.map((chatMessage, index) => (
                <div className={`chat-message chat-message--${chatMessage.role}`} key={`${chatMessage.role}-${index}`}>
                  <span className="chat-role">{chatMessage.role === 'user' ? 'You' : 'LUCID'}</span>
                  <p>{chatMessage.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="chat-form" onSubmit={handleSendMessage}>
            <input
              aria-label="Message"
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message LUCID"
            />
            <button type="submit" disabled={isSending || !message.trim() || !selectedModel.trim()}>
              {isSending ? 'Sending' : 'Send'}
            </button>
          </form>
        </section>
      </section>
    </main>
  )
}

export default App
