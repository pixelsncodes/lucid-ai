import { useId, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faMicrochip } from '@fortawesome/free-solid-svg-icons'

function ModelSelector({ models, selectedModel, modelStatus, onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const blurTimeoutRef = useRef(null)
  const listboxId = useId()
  const isReady = modelStatus === 'ready'
  const displayValue = selectedModel || (modelStatus === 'loading' ? 'Loading models' : 'No models found')

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

  const handleSelect = (model) => {
    onChange(model)
    setIsOpen(false)
  }

  return (
    <div className="setting-field setting-field--model model-select" onBlur={closeSoon} onFocus={cancelClose}>
      <span className="control-label" title="Model">
        <FontAwesomeIcon icon={faMicrochip} aria-hidden="true" />
      </span>
      <button
        type="button"
        className="model-select-button"
        disabled={!isReady}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label="Select model"
        title="Select model"
        onClick={() => setIsOpen((currentValue) => (isReady ? !currentValue : false))}
        onKeyDown={handleKeyDown}
      >
        <span>{displayValue}</span>
        <FontAwesomeIcon className="model-select-chevron" icon={faChevronDown} aria-hidden="true" />
      </button>

      {isOpen && isReady ? (
        <div className="model-select-menu" id={listboxId} role="listbox" aria-label="Models">
          {models.map((model) => (
            <button
              type="button"
              className={`model-select-option ${model === selectedModel ? 'model-select-option--selected' : ''}`}
              role="option"
              aria-selected={model === selectedModel}
              key={model}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(model)}
            >
              {model}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default ModelSelector
