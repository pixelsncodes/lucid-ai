import { useEffect, useRef, useState } from 'react'
import './App.css'
import AppShell from './components/AppShell'
import TopBar from './components/TopBar'
import VoiceWorkspace from './components/VoiceWorkspace'
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
  const [isChatOpen] = useState(true)
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
    ? 'Listening'
    : isTranscribing
      ? 'Transcribing'
      : isSending
        ? 'Thinking'
        : speechStatus === 'playing' || speechStatus === 'loading'
          ? 'Speaking'
          : 'Idle'

  const VoiceLoader =
    voiceStatusLabel === 'Listening'
      ? DotmSquare18
      : voiceStatusLabel === 'Transcribing' || voiceStatusLabel === 'Thinking'
        ? DotmSquare8
        : voiceStatusLabel === 'Speaking'
          ? DotmCircular8
          : DotmSquare1
  const voiceLoaderSettings = {
    Idle: {
      boxSize: 112,
      minSize: 112,
      dotSize: 12,
      cellPadding: 6,
      speed: 1.45,
      bloom: false,
      halo: 0,
      opacityBase: 0.28,
      opacityMid: 0.62,
      opacityPeak: 1,
      opacity: 0.86,
    },
    Listening: {
      boxSize: 112,
      minSize: 112,
      dotSize: 12,
      cellPadding: 6,
      speed: 0.74,
      bloom: false,
      halo: 0,
      opacityBase: 0.32,
      opacityMid: 0.68,
      opacityPeak: 1,
      opacity: 1,
    },
    Transcribing: {
      boxSize: 112,
      minSize: 112,
      dotSize: 12,
      cellPadding: 6,
      speed: 0.9,
      bloom: false,
      halo: 0,
      opacityBase: 0.3,
      opacityMid: 0.66,
      opacityPeak: 1,
      opacity: 0.94,
    },
    Thinking: {
      boxSize: 112,
      minSize: 112,
      dotSize: 12,
      cellPadding: 6,
      speed: 0.9,
      bloom: false,
      halo: 0,
      opacityBase: 0.3,
      opacityMid: 0.66,
      opacityPeak: 1,
      opacity: 0.94,
    },
    Speaking: {
      boxSize: 112,
      minSize: 112,
      dotSize: 12,
      cellPadding: 6,
      speed: 0.78,
      bloom: false,
      halo: 0,
      opacityBase: 0.32,
      opacityMid: 0.68,
      opacityPeak: 1,
      opacity: 1,
    },
  }[voiceStatusLabel]
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
    <AppShell
      topbar={
        <TopBar
          backendStatus={backendStatus}
        />
      }
    >
      <VoiceWorkspace
        VoiceLoader={VoiceLoader}
        voiceLoaderSettings={voiceLoaderSettings}
        voiceStatusLabel={voiceStatusLabel}
        voiceStatusDetail={voiceStatusDetail}
        voiceActionLabel={voiceActionLabel}
        isRecording={isRecording}
        recordingMode={recordingMode}
        isVoiceActionDisabled={isVoiceActionDisabled}
        handleToggleRecording={handleToggleRecording}
        chatMessages={chatMessages}
        voiceError={voiceError}
        controlDockProps={{
          models,
          selectedModel,
          modelStatus,
          temperature,
          numCtx,
          autoSpeak,
          conversationMode,
          onSelectedModelChange: setSelectedModel,
          onTemperatureChange: (value) =>
            setTemperature(
              clampFiniteNumber(
                value,
                MIN_TEMPERATURE,
                MAX_TEMPERATURE,
                DEFAULT_TEMPERATURE,
              ),
            ),
          onNumCtxChange: (value) => setNumCtx(clampContextSize(value)),
          onAutoSpeakChange: setAutoSpeak,
          onConversationModeChange: handleConversationModeChange,
        }}
        chatPanelProps={{
          isChatOpen,
          chatMessages,
          message,
          setMessage,
          handleSendMessage,
          handleToggleRecording,
          handleSpeakMessage,
          speakingMessageIndex,
          speechStatus,
          isSending,
          isRecording,
          isTranscribing,
          recordingMode,
          selectedModel,
          conversationMode,
        }}
      />
    </AppShell>
  )
}

export default App
