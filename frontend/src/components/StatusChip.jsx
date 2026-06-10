import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

function StatusChip({ icon, label, value, tone = 'neutral', className = '' }) {
  return (
    <span className={`status-chip status-chip--${tone} ${className}`.trim()}>
      <span className="status-chip-dot" aria-hidden="true" />
      {icon ? <FontAwesomeIcon className="status-chip-icon" icon={icon} aria-hidden="true" /> : null}
      <span className="status-chip-label">{label}</span>
      <span className="status-chip-value">{value}</span>
    </span>
  )
}

export default StatusChip
