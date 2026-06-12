import { useEffect, useRef } from 'react'
import { ASSISTANT_NAME } from '../identity'
import { SpeakerIcon, StopIcon } from './Icons'

function ChatLog({ messages, onSpeak, speakingIndex }) {
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <div className="chat-log" role="log" aria-label="Conversation">
      {messages.length === 0 ? (
        <p className="chat-log-empty">nothing yet. type below, or tap the grid and talk.</p>
      ) : (
        messages.map((chatMessage, index) => (
          <div key={index} className={`chat-row chat-row--${chatMessage.role}`}>
            <span className="chat-row-label">
              {chatMessage.role === 'user' ? 'you' : ASSISTANT_NAME.toLowerCase()}
            </span>
            <div className="chat-row-body">
              <p>{chatMessage.text}</p>
              {Array.isArray(chatMessage.sources) && chatMessage.sources.length > 0 ? (
                <p className="chat-row-sources">
                  {chatMessage.sources
                    .map((source) => String(source?.title || '').trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(' · ')}
                </p>
              ) : null}
            </div>
            {chatMessage.role === 'assistant' && chatMessage.text.trim() ? (
              <button
                type="button"
                className="chat-row-speak"
                onClick={() => onSpeak(chatMessage, index)}
                aria-label={speakingIndex === index ? 'Stop playback' : 'Play reply aloud'}
                title={speakingIndex === index ? 'Stop' : 'Play aloud'}
              >
                {speakingIndex === index ? <StopIcon /> : <SpeakerIcon />}
              </button>
            ) : null}
          </div>
        ))
      )}
      <div ref={endRef} />
    </div>
  )
}

export default ChatLog
