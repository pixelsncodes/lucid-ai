import { useId, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faVolumeHigh } from '@fortawesome/free-solid-svg-icons'

function VoiceSelector({ voices, selectedVoiceId, voiceStatus, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const blurTimeoutRef = useRef(null)
  const listboxId = useId()
  const availableVoices = voices.filter((voice) => voice.available)
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId)
  const isReady = voiceStatus === 'ready' && voices.length > 0
  const displayValue =
    selectedVoice?.name ||
    (voiceStatus === 'loading'
      ? 'Loading voices'
      : voiceStatus === 'offline'
        ? 'Voice fallback'
        : 'No voices')

  const closeSoon = () => {
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsOpen(false)
    }, 0)
  }

  const cancelClose = () => {
    if (blurTimeoutRef.current) {
      window.clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsOpen(false)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && !isOpen && isReady) {
      event.preventDefault()
      setIsOpen(true)
    }
  }

  const handleSelect = (voice) => {
    if (!voice.available) {
      return
    }

    onChange(voice.id)
    setIsOpen(false)
  }

  return (
    <div className="setting-field setting-field--voice voice-select" onBlur={closeSoon} onFocus={cancelClose}>
      <span className="control-label" title="Voice">
        <FontAwesomeIcon icon={faVolumeHigh} aria-hidden="true" />
      </span>
      <button
        type="button"
        className="voice-select-button"
        disabled={!isReady || availableVoices.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label="Select voice"
        title="Select voice"
        onClick={() => setIsOpen((currentValue) => (isReady ? !currentValue : false))}
        onKeyDown={handleKeyDown}
      >
        <span>{displayValue}</span>
        <FontAwesomeIcon className="voice-select-chevron" icon={faChevronDown} aria-hidden="true" />
      </button>

      {isOpen && isReady ? (
        <div className="voice-select-menu" id={listboxId} role="listbox" aria-label="Voices">
          {voices.map((voice) => (
            <button
              type="button"
              className={`voice-select-option ${voice.id === selectedVoiceId ? 'voice-select-option--selected' : ''}`}
              role="option"
              aria-selected={voice.id === selectedVoiceId}
              aria-disabled={!voice.available}
              disabled={!voice.available}
              key={voice.id}
              title={voice.description || voice.name}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(voice)}
            >
              <span>{voice.name}</span>
              <span>{voice.language || voice.engine}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default VoiceSelector
