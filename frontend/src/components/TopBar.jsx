import { useId, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faServer } from '@fortawesome/free-solid-svg-icons'
import StatusChip from './StatusChip'

function getBackendTone(status) {
  if (status === 'online') {
    return 'online'
  }

  if (status === 'offline') {
    return 'error'
  }

  return 'warning'
}

function TopBar({
  backendStatus,
  knowledgeBases = [],
  selectedKnowledgeBase = 'none',
  knowledgeBaseStatus = 'loading',
  onSelectedKnowledgeBaseChange,
}) {
  const [isKnowledgeBaseOpen, setIsKnowledgeBaseOpen] = useState(false)
  const blurTimeoutRef = useRef(null)
  const listboxId = useId()
  const isKnowledgeBaseDisabled = knowledgeBaseStatus === 'loading' || knowledgeBases.length === 0
  const selectedKnowledgeBaseName =
    knowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedKnowledgeBase)?.name ||
    (knowledgeBaseStatus === 'loading' ? 'Loading' : 'None')

  const closeSoon = () => {
    blurTimeoutRef.current = window.setTimeout(() => {
      setIsKnowledgeBaseOpen(false)
    }, 0)
  }

  const cancelClose = () => {
    if (blurTimeoutRef.current) {
      window.clearTimeout(blurTimeoutRef.current)
      blurTimeoutRef.current = null
    }
  }

  const handleKnowledgeBaseKeyDown = (event) => {
    if (event.key === 'Escape') {
      setIsKnowledgeBaseOpen(false)
      return
    }

    if ((event.key === 'Enter' || event.key === ' ') && !isKnowledgeBaseOpen && !isKnowledgeBaseDisabled) {
      event.preventDefault()
      setIsKnowledgeBaseOpen(true)
    }
  }

  const handleKnowledgeBaseSelect = (knowledgeBaseId) => {
    onSelectedKnowledgeBaseChange?.(knowledgeBaseId)
    setIsKnowledgeBaseOpen(false)
  }

  return (
    <header className="lucid-topbar">
      <div className="brand-block">
        <div className="brand-row">
          <h1 id="lucid-title" className="lucid-wordmark">LUCID</h1>
          <span className="local-mode-chip">Local Mode</span>
        </div>
        <p className="lucid-subtitle">Local Unified Conversational Intelligence Desk</p>
      </div>
      <div className="topbar-actions">
        <div className="knowledge-base-select" title="Knowledge base" onBlur={closeSoon} onFocus={cancelClose}>
          <span className="knowledge-base-select-label">KB</span>
          <span className="knowledge-base-select-shell">
            <button
              type="button"
              className="knowledge-base-select-button"
              disabled={isKnowledgeBaseDisabled}
              aria-haspopup="listbox"
              aria-expanded={isKnowledgeBaseOpen}
              aria-controls={listboxId}
              aria-label="Knowledge base"
              onClick={() =>
                setIsKnowledgeBaseOpen((currentValue) => (isKnowledgeBaseDisabled ? false : !currentValue))
              }
              onKeyDown={handleKnowledgeBaseKeyDown}
            >
              <span>{selectedKnowledgeBaseName}</span>
              <FontAwesomeIcon className="knowledge-base-select-chevron" icon={faChevronDown} aria-hidden="true" />
            </button>
          </span>
          {isKnowledgeBaseOpen && !isKnowledgeBaseDisabled ? (
            <div className="knowledge-base-select-menu" id={listboxId} role="listbox" aria-label="Knowledge bases">
              {knowledgeBases.map((knowledgeBase) => (
                <button
                  type="button"
                  className={`knowledge-base-select-option ${
                    knowledgeBase.id === selectedKnowledgeBase ? 'knowledge-base-select-option--selected' : ''
                  }`}
                  role="option"
                  aria-selected={knowledgeBase.id === selectedKnowledgeBase}
                  key={knowledgeBase.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleKnowledgeBaseSelect(knowledgeBase.id)}
                >
                  {knowledgeBase.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <StatusChip icon={faServer} label="Backend" value={backendStatus} tone={getBackendTone(backendStatus)} />
      </div>
    </header>
  )
}

export default TopBar
