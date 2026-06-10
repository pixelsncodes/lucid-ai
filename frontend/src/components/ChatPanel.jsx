import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSpinner, faStop, faVolumeHigh } from '@fortawesome/free-solid-svg-icons'

function ChatPanel({
  isChatOpen,
  chatMessages,
  handleSpeakMessage,
  speakingMessageIndex,
  speechStatus,
}) {
  return (
    <section
      id="lucid-chat-panel"
      className={`chat-panel ${isChatOpen ? 'chat-panel--open' : ''}`}
      aria-label="LUCID chat"
      hidden={!isChatOpen}
    >
      <div className="chat-area" aria-live="polite">
        {chatMessages.length === 0 ? (
          <p className="chat-empty">Start a local conversation.</p>
        ) : (
          chatMessages.map((chatMessage, index) => (
            <div className={`chat-message chat-message--${chatMessage.role}`} key={`${chatMessage.role}-${index}`}>
              <div className="chat-message-header">
                <span className="chat-role">{chatMessage.role === 'user' ? 'You' : 'Lucid'}</span>
                {chatMessage.role === 'assistant' ? (
                  <button
                    type="button"
                    className="speak-button"
                    onClick={() => handleSpeakMessage(chatMessage, index)}
                    disabled={speakingMessageIndex === index && speechStatus === 'loading'}
                    aria-label={
                      speakingMessageIndex === index && speechStatus === 'playing'
                        ? 'Stop assistant message playback'
                        : 'Speak assistant message'
                    }
                    title={
                      speakingMessageIndex === index && speechStatus === 'playing'
                        ? 'Stop'
                        : 'Speak'
                    }
                  >
                    <FontAwesomeIcon
                      icon={
                        speakingMessageIndex === index
                          ? speechStatus === 'playing'
                            ? faStop
                            : faSpinner
                          : faVolumeHigh
                      }
                      spin={speakingMessageIndex === index && speechStatus === 'loading'}
                      aria-hidden="true"
                    />
                  </button>
                ) : null}
              </div>
              <p>{chatMessage.text}</p>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default ChatPanel
