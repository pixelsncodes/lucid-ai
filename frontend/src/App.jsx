import './App.css'

const features = ['Offline LLM', 'Voice Chat', 'Local RAG']

function App() {
  return (
    <main className="landing">
      <section className="hero" aria-labelledby="lucid-title">
        <p className="eyebrow">Private AI workspace</p>
        <h1 id="lucid-title">LUCID</h1>
        <p className="subtitle">Local Unified Conversational Intelligence Desk</p>

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
