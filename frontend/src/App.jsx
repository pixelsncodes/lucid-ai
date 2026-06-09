import { useEffect, useState } from 'react'
import './App.css'

const features = ['Offline LLM', 'Voice Chat', 'Local RAG']

function App() {
  const [backendStatus, setBackendStatus] = useState('checking')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((response) => {
        setBackendStatus(response.ok ? 'online' : 'offline')
      })
      .catch(() => {
        setBackendStatus('offline')
      })
  }, [])

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
      </section>
    </main>
  )
}

export default App
