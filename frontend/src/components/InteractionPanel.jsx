import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCirclePlay, faMicrophone, faPaperPlane, faSpinner, faStop } from '@fortawesome/free-solid-svg-icons'
import ChatPanel from './ChatPanel'
import ControlDock from './ControlDock'

const getLastMessage = (messages, role) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return messages[index]
    }
  }

  return null
}

function ExchangeRow({ label, message }) {
  if (!message?.text) {
    return null
  }

  return (
    <div className="exchange-row">
      <span className="exchange-label">{label}</span>
      <p>{message.text}</p>
    </div>
  )
}

function InteractionPanel({ chatMessages, controlDockProps, chatPanelProps }) {
  const lastUserMessage = getLastMessage(chatMessages, 'user')
  const lastAssistantMessage = getLastMessage(chatMessages, 'assistant')
  const hasPreview = Boolean(lastUserMessage || lastAssistantMessage)
  const conversationVoiceLabel = chatPanelProps.autoSendVoice
    ? 'Conversation voice'
    : 'Transcribe voice'
  const stopConversationVoiceLabel = chatPanelProps.autoSendVoice
    ? 'Stop and send conversation voice'
    : 'Stop voice transcription'

  return (
    <section className="interaction-panel" aria-label="LUCID interaction">
      {chatPanelProps.isChatOpen ? (
        <ChatPanel {...chatPanelProps} />
      ) : (
        <div className="exchange-preview" aria-live="polite">
          {hasPreview ? (
            <>
              <ExchangeRow label="You" message={lastUserMessage} />
              <ExchangeRow label="Lucid" message={lastAssistantMessage} />
            </>
          ) : (
            <p className="exchange-empty">Ready.</p>
          )}
        </div>
      )}

      <form className="chat-form" onSubmit={chatPanelProps.handleSendMessage}>
        <input
          aria-label="Message"
          type="text"
          value={chatPanelProps.message}
          onChange={(event) => chatPanelProps.setMessage(event.target.value)}
          placeholder="Message"
        />
        <div className="chat-actions">
          <button
            type="button"
            className="record-button"
            onClick={() => chatPanelProps.handleToggleRecording('draft')}
            disabled={
              chatPanelProps.isSending ||
              chatPanelProps.isTranscribing ||
              (chatPanelProps.isRecording && chatPanelProps.recordingMode !== 'draft')
            }
            aria-label={
              chatPanelProps.isRecording && chatPanelProps.recordingMode === 'draft'
                ? 'Stop manual recording'
                : 'Manual record'
            }
            aria-pressed={chatPanelProps.isRecording && chatPanelProps.recordingMode === 'draft'}
            title={
              chatPanelProps.isRecording && chatPanelProps.recordingMode === 'draft'
                ? 'Stop manual recording'
                : 'Manual record'
            }
          >
            <FontAwesomeIcon
              icon={
                chatPanelProps.isTranscribing
                  ? faSpinner
                  : chatPanelProps.isRecording && chatPanelProps.recordingMode === 'draft'
                    ? faStop
                    : faMicrophone
              }
              spin={chatPanelProps.isTranscribing}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="record-button"
            onClick={() => chatPanelProps.handleToggleRecording('send')}
            disabled={
              chatPanelProps.isSending ||
              chatPanelProps.isTranscribing ||
              (chatPanelProps.autoSendVoice && !chatPanelProps.selectedModel.trim()) ||
              (chatPanelProps.isRecording && chatPanelProps.recordingMode !== 'send')
            }
            aria-label={
              chatPanelProps.isRecording && chatPanelProps.recordingMode === 'send'
                ? stopConversationVoiceLabel
                : conversationVoiceLabel
            }
            aria-pressed={chatPanelProps.isRecording && chatPanelProps.recordingMode === 'send'}
            title={
              chatPanelProps.isRecording && chatPanelProps.recordingMode === 'send'
                ? stopConversationVoiceLabel
                : conversationVoiceLabel
            }
          >
            <FontAwesomeIcon
              icon={
                chatPanelProps.isTranscribing
                  ? faSpinner
                  : chatPanelProps.isRecording && chatPanelProps.recordingMode === 'send'
                    ? faStop
                    : faCirclePlay
              }
              spin={chatPanelProps.isTranscribing}
              aria-hidden="true"
            />
          </button>
          <button
            type="submit"
            disabled={
              chatPanelProps.isSending ||
              chatPanelProps.isRecording ||
              chatPanelProps.isTranscribing ||
              !chatPanelProps.message.trim() ||
              !chatPanelProps.selectedModel.trim()
            }
            aria-label="Send typed message"
            title="Send typed message"
          >
            <FontAwesomeIcon icon={chatPanelProps.isSending ? faSpinner : faPaperPlane} spin={chatPanelProps.isSending} aria-hidden="true" />
          </button>
        </div>
      </form>

      <ControlDock {...controlDockProps} />
    </section>
  )
}

export default InteractionPanel
