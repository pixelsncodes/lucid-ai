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
  const isKnowledgeBaseDisabled = knowledgeBaseStatus === 'loading' || knowledgeBases.length === 0

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
        <label className="knowledge-base-select" title="Knowledge base">
          <span className="knowledge-base-select-label">KB</span>
          <span className="knowledge-base-select-shell">
            <select
              value={selectedKnowledgeBase}
              disabled={isKnowledgeBaseDisabled}
              aria-label="Knowledge base"
              onChange={(event) => onSelectedKnowledgeBaseChange?.(event.target.value)}
            >
              {knowledgeBases.map((knowledgeBase) => (
                <option key={knowledgeBase.id} value={knowledgeBase.id}>
                  {knowledgeBase.name}
                </option>
              ))}
            </select>
            <FontAwesomeIcon className="knowledge-base-select-chevron" icon={faChevronDown} aria-hidden="true" />
          </span>
        </label>
        <StatusChip icon={faServer} label="Backend" value={backendStatus} tone={getBackendTone(backendStatus)} />
      </div>
    </header>
  )
}

export default TopBar
