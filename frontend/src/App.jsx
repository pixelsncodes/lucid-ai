import { useEffect, useState } from 'react'
import './App.css'

const features = ['Offline LLM', 'Voice Chat', 'Local RAG']

function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((response) => {
        setBackendStatus(response.ok ? 'online' : 'offline')
      })
      .catch(() => {
        setBackendStatus('offline')
      })
  }, [])

  const handleSendMessage = async (event) => {
    event.preventDefault()

    const trimmedMessage = message.trim()
    if (!trimmedMessage || isSending) {
      return
    }

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
        body: JSON.stringify({ message: trimmedMessage }),
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
            <button type="submit" disabled={isSending || !message.trim()}>
              {isSending ? 'Sending' : 'Send'}
            </button>
          </form>
        </section>
      </section>
    </main>
  )
}

export default App
