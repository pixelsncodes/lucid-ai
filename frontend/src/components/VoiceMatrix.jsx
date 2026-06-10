function VoiceMatrix({
  VoiceLoader,
  voiceLoaderSettings,
  voiceStatusLabel,
  isRecording,
  recordingMode,
  isVoiceActionDisabled,
  onToggleRecording,
}) {
  const loaderSpeed = voiceStatusLabel === 'Idle' ? 0.4 : voiceLoaderSettings.speed

  return (
    <button
      type="button"
      className={`voice-button voice-button--${voiceStatusLabel.toLowerCase()}`}
      onClick={() => onToggleRecording('send')}
      disabled={isVoiceActionDisabled}
      aria-label={isRecording && recordingMode === 'send' ? 'Stop and send voice' : 'Record and send voice'}
      aria-pressed={isRecording && recordingMode === 'send'}
    >
      <VoiceLoader
        className="voice-loader"
        color="white"
        shape="circle"
        dotShape="circle"
        rows={5}
        columns={5}
        dotSize={voiceLoaderSettings.dotSize}
        cellPadding={voiceLoaderSettings.cellPadding}
        speed={loaderSpeed}
        boxSize={voiceLoaderSettings.boxSize}
        minSize={voiceLoaderSettings.minSize}
        bloom={voiceLoaderSettings.bloom}
        halo={voiceLoaderSettings.halo}
        opacityBase={voiceLoaderSettings.opacityBase}
        opacityMid={voiceLoaderSettings.opacityMid}
        opacityPeak={voiceLoaderSettings.opacityPeak}
        opacity={voiceLoaderSettings.opacity}
        style={{
          '--dotmatrix-gap': `${voiceLoaderSettings.cellPadding}px`,
          '--voice-loader-box-size': `${voiceLoaderSettings.boxSize}px`,
          '--voice-loader-min-size': `${voiceLoaderSettings.minSize}px`,
          '--voice-loader-opacity-base': voiceLoaderSettings.opacityBase,
          '--voice-loader-opacity-mid': voiceLoaderSettings.opacityMid,
          '--voice-loader-opacity-peak': voiceLoaderSettings.opacityPeak,
          opacity: voiceLoaderSettings.opacity,
        }}
        aria-label={voiceStatusLabel}
      />
    </button>
  )
}

export default VoiceMatrix
