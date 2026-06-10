import InteractionPanel from './InteractionPanel'
import VoiceMatrix from './VoiceMatrix'

function VoiceWorkspace({
  VoiceLoader,
  voiceLoaderSettings,
  voiceStatusLabel,
  voiceStatusDetail,
  voiceActionLabel,
  isRecording,
  recordingMode,
  isVoiceActionDisabled,
  handleToggleRecording,
  chatMessages,
  voiceError,
  controlDockProps,
  chatPanelProps,
}) {
  return (
    <section className="voice-stage" aria-labelledby="lucid-title">
      <div className="voice-workspace">
        <div className="voice-core">
          <VoiceMatrix
            VoiceLoader={VoiceLoader}
            voiceLoaderSettings={voiceLoaderSettings}
            voiceStatusLabel={voiceStatusLabel}
            isRecording={isRecording}
            recordingMode={recordingMode}
            isVoiceActionDisabled={isVoiceActionDisabled}
            onToggleRecording={handleToggleRecording}
          />
          <div className="voice-copy" aria-live="polite">
            <p className="voice-status-line">{voiceStatusLabel}</p>
          </div>
        </div>

        <InteractionPanel
          chatMessages={chatMessages}
          controlDockProps={controlDockProps}
          chatPanelProps={chatPanelProps}
        />
        {voiceError ? (
          <p className="voice-error" role="alert">
            {voiceError}
          </p>
        ) : null}
      </div>

    </section>
  )
}

export default VoiceWorkspace
