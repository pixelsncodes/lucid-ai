import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

function ToggleControl({ id, icon, label, checked, disabled, onChange }) {
  return (
    <label className="dock-toggle" htmlFor={id}>
      <span className="control-label" title={label}>
        {icon ? <FontAwesomeIcon icon={icon} aria-hidden="true" /> : label}
      </span>
      <span className="toggle-shell">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
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
