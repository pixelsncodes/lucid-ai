import { faServer } from '@fortawesome/free-solid-svg-icons'
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

function TopBar({ backendStatus }) {
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
        <StatusChip icon={faServer} label="Backend" value={backendStatus} tone={getBackendTone(backendStatus)} />
      </div>
    </header>
  )
}

export default TopBar
