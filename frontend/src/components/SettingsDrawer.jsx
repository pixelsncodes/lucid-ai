import { useEffect, useRef } from 'react'
import { ASSISTANT_NAME, ASSISTANT_EXPANSION, ASSISTANT_TAGLINE } from '../identity'
import { CloseIcon } from './Icons'

function Toggle({ label, checked, disabled, onChange }) {
  return (
    <label className={`tog-row${disabled ? ' tog-row--disabled' : ''}`}>
      <span>{label}</span>
      <span className="tog">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="tog-track" />
      </span>
    </label>
  )
}

function Slider({ label, min, max, step, value, format, onChange }) {
  return (
    <div className="slider-row">
      <span className="slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <span className="slider-value">{format(value)}</span>
    </div>
  )
}

function SettingsDrawer({
  open,
  onClose,
  models,
  selectedModel,
  onSelectedModelChange,
  voices,
  selectedVoiceId,
  onSelectedVoiceIdChange,
  speechRate,
  onSpeechRateChange,
  knowledgeBases,
  selectedKnowledgeBase,
  onSelectedKnowledgeBaseChange,
  temperature,
  onTemperatureChange,
  numCtx,
  onNumCtxChange,
  autoSpeak,
  onAutoSpeakChange,
  autoSendVoice,
  onAutoSendVoiceChange,
  backendStatus,
}) {
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
      >
        <div className="drawer-head">
          <span className="drawer-title">settings</span>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer-scroll">
          <section>
            <h3 className="group-title">Model</h3>
            <select
              className="drawer-select"
              value={selectedModel}
              onChange={(event) => onSelectedModelChange(event.target.value)}
              disabled={models.length === 0}
              aria-label="Model"
            >
              {models.length === 0 ? <option value="">no models found</option> : null}
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </section>

          <section>
            <h3 className="group-title">Voice</h3>
            <select
              className="drawer-select"
              value={selectedVoiceId}
              onChange={(event) => onSelectedVoiceIdChange(event.target.value)}
              disabled={voices.length === 0}
              aria-label="Voice"
            >
              {voices.length === 0 ? <option value="">no voices found</option> : null}
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id} disabled={!voice.available}>
                  {voice.name}
                  {voice.available ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
            <div className="group-gap" />
            <Slider
              label="Speech rate"
              min={0.8}
              max={1.2}
              step={0.05}
              value={speechRate}
              format={(v) => `${v.toFixed(2)}\u00d7`}
              onChange={onSpeechRateChange}
            />
          </section>

          <section>
            <h3 className="group-title">Knowledge base</h3>
            <select
              className="drawer-select"
              value={selectedKnowledgeBase}
              onChange={(event) => onSelectedKnowledgeBaseChange(event.target.value)}
              disabled={knowledgeBases.length === 0}
              aria-label="Knowledge base"
            >
              {knowledgeBases.map((knowledgeBase) => (
                <option key={knowledgeBase.id} value={knowledgeBase.id}>
                  {knowledgeBase.name}
                </option>
              ))}
            </select>
          </section>

          <div className="drawer-divider" />

          <section>
            <h3 className="group-title">Generation</h3>
            <Slider
              label="Temperature"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              format={(v) => v.toFixed(1)}
              onChange={onTemperatureChange}
            />
            <Slider
              label="Context"
              min={512}
              max={32000}
              step={256}
              value={numCtx}
              format={(v) => String(Math.round(v))}
              onChange={onNumCtxChange}
            />
          </section>

          <div className="drawer-divider" />

          <section>
            <h3 className="group-title">Voice mode</h3>
            <Toggle label="Speak replies aloud" checked={autoSpeak} onChange={onAutoSpeakChange} />
            <Toggle
              label="Send voice automatically"
              checked={autoSendVoice}
              onChange={onAutoSendVoiceChange}
            />
          </section>
        </div>

        <footer className="drawer-foot">
          <p className="drawer-identity">
            {ASSISTANT_NAME} · {ASSISTANT_EXPANSION}
          </p>
          <p className="drawer-meta">
            {ASSISTANT_TAGLINE} · backend {backendStatus}
          </p>
        </footer>
      </aside>
    </div>
  )
}

export default SettingsDrawer
