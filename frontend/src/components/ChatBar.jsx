import { MicIcon, SendIcon, StopIcon } from './Icons'

function ChatBar({
  message,
  onMessageChange,
  onSend,
  onDictate,
  onFocusInput,
  isRecordingDraft,
  isTranscribing,
  isSending,
  canSend,
}) {
  const handleSubmit = (event) => {
    event.preventDefault()
    onSend()
  }

  return (
    <form className="chat-bar" onSubmit={handleSubmit}>
      <input
        type="text"
        aria-label="Message"
        placeholder="Say something…"
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        onFocus={onFocusInput}
      />
      <button
        type="button"
        className={`chat-bar-button${isRecordingDraft ? ' chat-bar-button--live' : ''}`}
        onClick={onDictate}
        disabled={isTranscribing || isSending}
        aria-label={isRecordingDraft ? 'Stop dictating' : 'Dictate'}
        aria-pressed={isRecordingDraft}
        title={isRecordingDraft ? 'Stop dictating' : 'Dictate'}
      >
        {isRecordingDraft ? <StopIcon /> : <MicIcon />}
      </button>
      <button
        type="submit"
        className="chat-bar-button chat-bar-button--send"
        disabled={!canSend}
        aria-label="Send message"
        title="Send"
      >
        <SendIcon />
      </button>
    </form>
  )
}

export default ChatBar
