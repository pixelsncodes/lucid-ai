import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

function ToggleControl({ id, icon, label, checked, disabled, onChange }) {
  const isDisabled = Boolean(disabled)

  return (
    <label className={`dock-toggle ${isDisabled ? 'dock-toggle--disabled' : ''}`} htmlFor={id}>
      <span className="control-label" title={label}>
        {icon ? <FontAwesomeIcon icon={icon} aria-hidden="true" /> : label}
      </span>
      <span className="toggle-shell">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
      </span>
    </label>
  )
}

export default ToggleControl
