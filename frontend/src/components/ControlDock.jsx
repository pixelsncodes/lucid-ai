import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowsRotate, faDatabase, faMinus, faPlus, faSliders, faVolumeHigh } from '@fortawesome/free-solid-svg-icons'
import ModelSelector from './ModelSelector'
import ToggleControl from './ToggleControl'

const clampSteppedValue = (value, min, max, fallback) => {
  const nextValue = Number(value)

  if (!Number.isFinite(nextValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, nextValue))
}

function StepperInput({
  id,
  icon,
  title,
  value,
  min,
  max,
  step,
  onChange,
}) {
  const updateByStep = (direction) => {
    const fallback = direction > 0 ? min : max
    const nextValue = clampSteppedValue(Number(value) + step * direction, min, max, fallback)
    const roundedValue = Number(nextValue.toFixed(step < 1 ? 1 : 0))

    onChange(String(roundedValue))
  }

  return (
    <label className="setting-field setting-field--stepper" htmlFor={id}>
      <span className="control-label" title={title}>
        <FontAwesomeIcon icon={icon} aria-hidden="true" />
      </span>
      <button
        type="button"
        className="stepper-button"
        onClick={() => updateByStep(-1)}
        aria-label={`Decrease ${title.toLowerCase()}`}
        title={`Decrease ${title.toLowerCase()}`}
      >
        <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
      </button>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="stepper-button"
        onClick={() => updateByStep(1)}
        aria-label={`Increase ${title.toLowerCase()}`}
        title={`Increase ${title.toLowerCase()}`}
      >
        <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
      </button>
    </label>
  )
}

function ControlDock({
  models,
  selectedModel,
  modelStatus,
  temperature,
  numCtx,
  autoSpeak,
  conversationMode,
  onSelectedModelChange,
  onTemperatureChange,
  onNumCtxChange,
  onAutoSpeakChange,
  onConversationModeChange,
}) {
  return (
    <section className="control-dock" aria-label="LUCID settings">
      <div className="dock-grid">
        <ModelSelector
          models={models}
          selectedModel={selectedModel}
          modelStatus={modelStatus}
          onChange={onSelectedModelChange}
        />

        <StepperInput
          id="temperature-input"
          icon={faSliders}
          title="Temperature"
          value={temperature}
          min={0}
          max={2}
          step={0.1}
          onChange={onTemperatureChange}
        />

        <StepperInput
          id="context-input"
          icon={faDatabase}
          title="Context"
          value={numCtx}
          min={512}
          max={32000}
          step={512}
          onChange={onNumCtxChange}
        />

        <ToggleControl
          id="auto-speak-input"
          icon={faVolumeHigh}
          label="Speak"
          checked={autoSpeak}
          disabled={conversationMode}
          onChange={onAutoSpeakChange}
        />

        <ToggleControl
          id="conversation-mode-input"
          icon={faArrowsRotate}
          label="Mode"
          checked={conversationMode}
          onChange={onConversationModeChange}
        />
      </div>

    </section>
  )
}

export default ControlDock
