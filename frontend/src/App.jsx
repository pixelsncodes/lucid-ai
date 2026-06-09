import { useEffect, useRef, useState } from 'react'
import './App.css'
import DotmCircular8 from './components/dotmatrix/DotmCircular8'
import DotmSquare1 from './components/dotmatrix/DotmSquare1'
import DotmSquare8 from './components/dotmatrix/DotmSquare8'
import DotmSquare18 from './components/dotmatrix/DotmSquare18'

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_NUM_CTX = 4096
const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 2
const MIN_NUM_CTX = 512
const MAX_NUM_CTX = 32000
const MAX_HISTORY_MESSAGES = 12
const MAX_HISTORY_CONTENT_LENGTH = 2000
const MAX_RECORDING_SECONDS = 30
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

const clampFiniteNumber = (value, min, max, fallback) => {
  const nextValue = Number(value)

  if (!Number.isFinite(nextValue)) {
    return fallback
  }

  return Math.min(max, Math.max(min, nextValue))
}

const clampContextSize = (value) =>
  Math.round(clampFiniteNumber(value, MIN_NUM_CTX, MAX_NUM_CTX, DEFAULT_NUM_CTX))

function App() {
  const [backendStatus, setBackendStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [isSending, setIsSending] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingMode, setRecordingMode] = useState(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState('')
  const [modelStatus, setModelStatus] = useState('loading')
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE)
  const [numCtx, setNumCtx] = useState(DEFAULT_NUM_CTX)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [conversationMode, setConversationMode] = useState(true)
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null)
  const [speechStatus, setSpeechStatus] = useState(null)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const mediaStreamRef = useRef(null)
  const recordingModeRef = useRef(null)
  const recordingTimeoutRef = useRef(null)
  const chatMessagesRef = useRef([])
  const autoSpeakRef = useRef(true)
  const nextChatMessageIdRef = useRef(1)
  const autoSpokenMessageIdsRef = useRef(new Set())
  const activeSpeechRef = useRef(null)

  const clearRecordingTimeout = () => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
  }

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then((response) => {
        setBackendStatus(response.ok ? 'online' : 'offline')
      })
      .catch(() => {
        setBackendStatus('offline')
      })
  }, [])

  useEffect(() => {
    fetch('http://localhost:8000/models')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Models request failed')
        }

        return response.json()
      })
      .then((data) => {
        const availableModels = Array.isArray(data.models) ? data.models : []
        const defaultModel = data.default_model || availableModels[0] || ''

        setModels(availableModels)
        setSelectedModel(defaultModel)
        setModelStatus(availableModels.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => {
        setModels([])
        setSelectedModel('')
        setModelStatus('offline')
      })
  }, [])

  useEffect(
    () => () => {
      clearRecordingTimeout()
      activeSpeechRef.current?.cleanup({ abortRequest: true, stopAudio: true })
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    },
    [],
  )

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages])

  useEffect(() => {
    autoSpeakRef.current = autoSpeak
  }, [autoSpeak])

  const sendChatMessage = async (
    text,
    { allowDuringTranscribe = false, allowDuringRecording = false } = {},
  ) => {
    const trimmedMessage = text.trim()
    const trimmedModel = selectedModel.trim()
    const safeTemperature = clampFiniteNumber(
      temperature,
      MIN_TEMPERATURE,
      MAX_TEMPERATURE,
      DEFAULT_TEMPERATURE,
    )
    const safeNumCtx = clampContextSize(numCtx)

    if (
      !trimmedMessage ||
      !trimmedModel ||
      isSending ||
      (isRecording && !allowDuringRecording) ||
      (isTranscribing && !allowDuringTranscribe)
    ) {
      return false
    }

    const history = chatMessagesRef.current
      .filter((chatMessage) => ['user', 'assistant'].includes(chatMessage.role))
      .map((chatMessage) => ({
        role: chatMessage.role,
        content: chatMessage.text.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH),
      }))
      .filter((chatMessage) => chatMessage.content)
      .slice(-MAX_HISTORY_MESSAGES)
    const userMessage = { role: 'user', text: trimmedMessage }
    setChatMessages((currentMessages) => [...currentMessages, userMessage])
    setMessage('')
    setIsSending(true)

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedMessage,
          history,
          model: trimmedModel,
          temperature: safeTemperature,
          num_ctx: safeNumCtx,
        }),
      })

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      const data = await response.json()
      const assistantMessage = {
        id: nextChatMessageIdRef.current++,
        role: 'assistant',
        text: data.reply || 'No reply received.',
        autoSpeak: autoSpeakRef.current,
      }

      setChatMessages((currentMessages) => [
        ...currentMessages,
        assistantMessage,
      ])
    } catch {
      setChatMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', text: 'Unable to reach the chat backend.' },
      ])
    } finally {
      setIsSending(false)
    }

    return true
  }

  const transcribeAudio = async (audioBlob, { autoSend = false } = {}) => {
    setIsTranscribing(true)
    setVoiceError('')

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const response = await fetch('http://localhost:8000/stt', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Transcription request failed')
      }

      const data = await response.json()
      const transcript = data.text || data.transcript || ''

      if (!transcript.trim()) {
        throw new Error('No transcript returned')
      }

      if (autoSend) {
        await sendChatMessage(transcript, {
          allowDuringTranscribe: true,
          allowDuringRecording: true,
        })
      } else {
        setMessage(transcript)
      }
    } catch {
      setVoiceError('Unable to transcribe audio.')
    } finally {
      setIsTranscribing(false)
    }
  }

  const handleToggleRecording = async (mode = 'draft') => {
    if (isTranscribing || isSending || (mode === 'send' && !selectedModel.trim())) {
      return
    }

    if (isRecording) {
      if (recordingModeRef.current === mode) {
        clearRecordingTimeout()
        mediaRecorderRef.current?.stop()
      }
      return
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceError('Audio recording is not supported in this browser.')
      return
    }

    try {
      setVoiceError('')
      audioChunksRef.current = []

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingModeRef.current = mode
      setRecordingMode(mode)

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const stoppedMode = recordingModeRef.current
        clearRecordingTimeout()
        setIsRecording(false)
        setRecordingMode(null)
        recordingModeRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        })
        audioChunksRef.current = []

        if (audioBlob.size > 0) {
          transcribeAudio(audioBlob, { autoSend: stoppedMode === 'send' })
        } else {
          setVoiceError('No audio was recorded.')
        }
      }

      recorder.start()
      recordingTimeoutRef.current = window.setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop()
        }
      }, MAX_RECORDING_SECONDS * 1000)
      setIsRecording(true)
    } catch {
      clearRecordingTimeout()
      setIsRecording(false)
      setRecordingMode(null)
      recordingModeRef.current = null
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
      setVoiceError('Unable to access the microphone.')
    }
  }

  const handleSendMessage = async (event) => {
    event.preventDefault()
    await sendChatMessage(message)
  }

  const handleConversationModeChange = (enabled) => {
    setConversationMode(enabled)
    setAutoSpeak(enabled)
    autoSpeakRef.current = enabled
  }

  const stopActiveSpeech = () => {
    activeSpeechRef.current?.cleanup({ abortRequest: true, stopAudio: true })
  }

  const handleSpeakMessage = async (chatMessage, index) => {
    if (!chatMessage.text.trim()) {
      return
    }

    if (activeSpeechRef.current?.index === index) {
      stopActiveSpeech()
      return
    }

    stopActiveSpeech()
    setSpeakingMessageIndex(index)
    setSpeechStatus('loading')

    const controller = new AbortController()
    let audio = null
    let audioUrl = ''
    let hasCleanedUp = false
    const cleanupSpeakMessage = ({ abortRequest = false, stopAudio = false } = {}) => {
      if (hasCleanedUp) {
        return
      }

      hasCleanedUp = true

      if (abortRequest) {
        controller.abort()
      }

      if (audio) {
        audio.removeEventListener('ended', cleanupSpeakMessage)
        audio.removeEventListener('error', cleanupSpeakMessage)

        if (stopAudio) {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        }
      }

      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }

      const isActiveSpeech = activeSpeechRef.current?.cleanup === cleanupSpeakMessage

      if (isActiveSpeech) {
        activeSpeechRef.current = null
      }

      setSpeakingMessageIndex((currentIndex) => (currentIndex === index ? null : currentIndex))
      setSpeechStatus((currentStatus) => (isActiveSpeech ? null : currentStatus))
    }

    activeSpeechRef.current = {
      index,
      cleanup: cleanupSpeakMessage,
    }

    try {
      const response = await fetch('http://localhost:8000/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: chatMessage.text }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('TTS request failed')
      }

      const audioBlob = await response.blob()
      audioUrl = URL.createObjectURL(audioBlob)
      audio = new Audio(audioUrl)

      audio.addEventListener('ended', cleanupSpeakMessage, { once: true })
      audio.addEventListener('error', cleanupSpeakMessage, { once: true })
      try {
        await audio.play()
        if (!hasCleanedUp && activeSpeechRef.current?.cleanup === cleanupSpeakMessage) {
          setSpeechStatus('playing')
        }
      } catch (error) {
        cleanupSpeakMessage()
        throw error
      }
    } catch {
      cleanupSpeakMessage()
      // TTS playback is manually requested, so failures should not affect chat behavior.
    }
  }

  useEffect(() => {
    const lastMessageIndex = chatMessages.length - 1
    const lastMessage = chatMessages[lastMessageIndex]

    if (
      lastMessage?.role !== 'assistant' ||
      !lastMessage.autoSpeak ||
      autoSpokenMessageIdsRef.current.has(lastMessage.id)
    ) {
      return
    }

    autoSpokenMessageIdsRef.current.add(lastMessage.id)
    handleSpeakMessage(lastMessage, lastMessageIndex)
  }, [chatMessages])

  const voiceStatusLabel = isRecording
    ? 'Recording'
    : isTranscribing
      ? 'Transcribing'
      : isSending
        ? 'Thinking'
        : speechStatus === 'playing' || speechStatus === 'loading'
          ? 'Speaking'
          : 'Idle'

  const VoiceLoader =
    voiceStatusLabel === 'Recording'
      ? DotmSquare18
      : voiceStatusLabel === 'Transcribing' || voiceStatusLabel === 'Thinking'
        ? DotmSquare8
        : voiceStatusLabel === 'Speaking'
          ? DotmCircular8
          : DotmSquare1
  const voiceStatusDetail = isRecording
    ? `Listening · ${MAX_RECORDING_SECONDS}s max`
    : isTranscribing
      ? 'Transcribing voice'
      : isSending
        ? 'Thinking locally'
        : speechStatus === 'playing' || speechStatus === 'loading'
          ? 'Speaking response'
          : selectedModel.trim()
            ? 'Ready for voice'
            : 'Select a model'
  const isVoiceActionDisabled =
    isSending ||
    isTranscribing ||
    !selectedModel.trim() ||
    (isRecording && recordingMode !== 'send')
  const voiceActionLabel = isTranscribing
    ? 'Transcribing'
    : isRecording && recordingMode === 'send'
      ? 'Stop & Send'
      : 'Speak'

  return (
    <main className="lucid-shell">
      <header className="lucid-topbar">
        <div>
          <h1 id="lucid-title" className="lucid-wordmark">LUCID</h1>
          <p className="lucid-subtitle">Local Unified Conversational Intelligence Desk</p>
        </div>
        <div className="topbar-actions">
          <p className={`backend-status backend-status--${backendStatus}`} aria-live="polite">
            Backend: {backendStatus}
          </p>
          <button
            type="button"
            className="chat-toggle"
            onClick={() => setIsChatOpen((currentValue) => !currentValue)}
            aria-expanded={isChatOpen}
            aria-controls="lucid-chat-panel"
          >
            {isChatOpen ? 'Hide Chat' : 'Chat'}
          </button>
        </div>
      </header>

      <section className="voice-stage" aria-labelledby="lucid-title">
        <div className="voice-control">
          <button
            type="button"
            className={`voice-button voice-button--${voiceStatusLabel.toLowerCase()}`}
            onClick={() => handleToggleRecording('send')}
            disabled={isVoiceActionDisabled}
            aria-label={isRecording && recordingMode === 'send' ? 'Stop and send voice' : 'Record and send voice'}
            aria-pressed={isRecording && recordingMode === 'send'}
          >
            <VoiceLoader
              className="voice-loader"
              color="currentColor"
              dotSize={voiceStatusLabel === 'Idle' ? 14 : 12}
              gap={voiceStatusLabel === 'Idle' ? 0 : 6}
              speed={voiceStatusLabel === 'Recording' ? 0.82 : 1}
              aria-label={voiceStatusLabel}
            />
          </button>
          <div className="voice-copy" aria-live="polite">
            <p className="voice-status-label">{voiceStatusLabel}</p>
            <p className="voice-status-detail">{voiceStatusDetail}</p>
            <p className="voice-action-label">{voiceActionLabel}</p>
          </div>
        </div>

        <section className="settings-panel" aria-label="LUCID settings">
          <div className="settings-row">
            <label className="setting-field" htmlFor="model-select">
              <span>Model</span>
              <select
                id="model-select"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                disabled={modelStatus !== 'ready'}
              >
                {models.length > 0 ? (
                  models.map((model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {modelStatus === 'loading' ? 'Loading models' : 'No models found'}
                  </option>
                )}
              </select>
            </label>

            <label className="setting-field" htmlFor="temperature-input">
              <span>Temperature</span>
              <input
                id="temperature-input"
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(event) =>
                  setTemperature(
                    clampFiniteNumber(
                      event.target.value,
                      MIN_TEMPERATURE,
                      MAX_TEMPERATURE,
                      DEFAULT_TEMPERATURE,
                    ),
                  )
                }
              />
            </label>

            <label className="setting-field" htmlFor="context-input">
              <span>Context</span>
              <input
                id="context-input"
                type="number"
                min="512"
                max="32000"
                step="512"
                value={numCtx}
                onChange={(event) => setNumCtx(clampContextSize(event.target.value))}
              />
            </label>

            <label className="setting-field setting-checkbox" htmlFor="auto-speak-input">
              <span>Auto Speak</span>
              <input
                id="auto-speak-input"
                type="checkbox"
                checked={autoSpeak}
                disabled={conversationMode}
                onChange={(event) => setAutoSpeak(event.target.checked)}
              />
            </label>

            <label className="setting-field setting-checkbox" htmlFor="conversation-mode-input">
              <span>Conversation Mode</span>
              <input
                id="conversation-mode-input"
                type="checkbox"
                checked={conversationMode}
                onChange={(event) => handleConversationModeChange(event.target.checked)}
              />
            </label>
          </div>

          {conversationMode ? (
            <div className="conversation-helper" role="note">
              Conversation Mode uses press-to-record, then Stop &amp; Send. It is not continuous listening yet.
            </div>
          ) : null}
        </section>

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
                    <span className="chat-role">{chatMessage.role === 'user' ? 'You' : 'LUCID'}</span>
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
                      >
                        {speakingMessageIndex === index
                          ? speechStatus === 'playing'
                            ? 'Stop'
                            : 'Loading'
                          : 'Speak'}
                      </button>
                    ) : null}
                  </div>
                  <p>{chatMessage.text}</p>
                </div>
              ))
            )}
          </div>

          <form className="chat-form" onSubmit={handleSendMessage}>
            <input
              aria-label="Message"
              type="text"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Message LUCID"
            />
            <div className="chat-actions">
              <button
                type="button"
                className="record-button"
                onClick={() => handleToggleRecording('draft')}
                disabled={isSending || isTranscribing || (isRecording && recordingMode !== 'draft')}
                aria-label={isRecording ? 'Stop recording' : 'Record audio'}
                aria-pressed={isRecording && recordingMode === 'draft'}
              >
                {isTranscribing
                  ? 'Transcribing'
                  : isRecording && recordingMode === 'draft'
                    ? 'Stop'
                    : 'Record'}
              </button>
              <button
                type="button"
                className="record-button"
                onClick={() => handleToggleRecording('send')}
                disabled={
                  isSending ||
                  isTranscribing ||
                  !selectedModel.trim() ||
                  (isRecording && recordingMode !== 'send')
                }
                aria-label={isRecording && recordingMode === 'send' ? 'Stop and send voice' : 'Send voice'}
                aria-pressed={isRecording && recordingMode === 'send'}
              >
                {isTranscribing
                  ? 'Transcribing'
                  : isRecording && recordingMode === 'send'
                    ? 'Stop & Send'
                    : conversationMode
                      ? 'Start Conversation'
                      : 'Send Voice'}
              </button>
              <button
                type="submit"
                disabled={isSending || isRecording || isTranscribing || !message.trim() || !selectedModel.trim()}
                aria-label="Send message"
              >
                {isSending ? 'Sending' : 'Send'}
              </button>
            </div>
          </form>
        </section>
        {voiceError ? (
          <p className="voice-error" role="alert">
            {voiceError}
          </p>
        ) : null}
      </section>
    </main>
  )
}

export default App
