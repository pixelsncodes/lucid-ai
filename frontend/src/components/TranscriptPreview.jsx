const getLastMessage = (messages, role) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return messages[index]
    }
  }

  return null
}

function TranscriptBlock({ label, message, emptyText }) {
  return (
    <div className="transcript-block">
      <div className="transcript-label">{label}</div>
      <p className={message ? 'transcript-text' : 'transcript-text transcript-text--empty'}>
        {message?.text || emptyText}
      </p>
    </div>
  )
}

function TranscriptPreview({ chatMessages }) {
  const lastUserMessage = getLastMessage(chatMessages, 'user')
  const lastAssistantMessage = getLastMessage(chatMessages, 'assistant')
  const hasTranscript = Boolean(lastUserMessage || lastAssistantMessage)

  return (
    <section className="transcript-preview" aria-label="Transcript preview">
      <div className="transcript-header">
        <span>Transcript</span>
        <span>{hasTranscript ? 'Latest exchange' : 'Standby'}</span>
      </div>
      <div className="transcript-content">
        <TranscriptBlock label="You" message={lastUserMessage} emptyText="No voice input yet." />
        <TranscriptBlock label="Lucid" message={lastAssistantMessage} emptyText="Response preview will appear here." />
      </div>
    </section>
  )
}

export default TranscriptPreview
