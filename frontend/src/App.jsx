import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { ASSISTANT_NAME, LAUGH_AUDIO_ENABLED } from './identity'
import { extractReplyFace } from './components/matrix/engine'
import MatrixStage from './components/MatrixStage'
import ChatBar from './components/ChatBar'
import ChatLog from './components/ChatLog'
import SettingsDrawer from './components/SettingsDrawer'
import { GearIcon } from './components/Icons'

const DEFAULT_TEMPERATURE = 0.7
const DEFAULT_NUM_CTX = 4096
const MIN_TEMPERATURE = 0
const MAX_TEMPERATURE = 2
const MIN_NUM_CTX = 512
const MAX_NUM_CTX = 32000
const MAX_HISTORY_MESSAGES = 12
const MAX_HISTORY_CONTENT_LENGTH = 2000
const MAX_RECORDING_SECONDS = 30
const RESUME_LISTEN_DELAY_MS = 420
const TTS_START_TIMEOUT_MS = 5000
const LAUGH_PRE_BEAT_MS = 200
const AUDIO_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const API_BASE_URL = 'http://127.0.0.1:8000'
const FALLBACK_KNOWLEDGE_BASES = [{ id: 'none', name: 'None' }]

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
  const [voices, setVoices] = useState([])
  const [selectedVoiceId, setSelectedVoiceId] = useState('')
  const [speechRate, setSpeechRate] = useState(0.95)
  const [knowledgeBases, setKnowledgeBases] = useState(FALLBACK_KNOWLEDGE_BASES)
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState('none')
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE)
  const [numCtx, setNumCtx] = useState(DEFAULT_NUM_CTX)
  // Voice-first defaults: replies are spoken, voice is sent automatically.
  const [autoSpeak, setAutoSpeak] = useState(true)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [speakingMessageIndex, setSpeakingMessageIndex] = useState(null)
  const [speechStatus, setSpeechStatus] = useState(null)
  const [uiMode, setUiMode] = useState('voice') // 'voice' | 'chat'
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [conversationActive, setConversationActive] = useState(false)
  const [analyser, setAnalyser] = useState(null)
  const [replyFace, setReplyFace] = useState(null) // { face, id }
  const [isLaughing, setIsLaughing] = useState(false)
  const [lastInteraction, setLastInteraction] = useState(() => Date.now())

  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const mediaStreamRef = useRef(null)
  const audioContextRef = useRef(null)
  const recordingModeRef = useRef(null)
  const recordingTimeoutRef = useRef(null)
  const discardRecordingRef = useRef(false)
  const chatMessagesRef = useRef([])
  const autoSpeakRef = useRef(true)
  const autoSendVoiceRef = useRef(true)
  const conversationActiveRef = useRef(false)
  const resumeListenTimerRef = useRef(null)
  const nextChatMessageIdRef = useRef(1)
  const autoSpokenMessageIdsRef = useRef(new Set())
  const activeSpeechRef = useRef(null)
  const laughRunRef = useRef(null)
  const haHaAudioRef = useRef(null)
  const baDumTssAudioRef = useRef(null)

  const markInteraction = useCallback(() => setLastInteraction(Date.now()), [])

  // Preload sfx clips so the first joke isn't silent.
  useEffect(() => {
    const haHa = new Audio('/sfx/ha-ha-01.mp3')
    haHa.preload = 'auto'
    haHaAudioRef.current = haHa
    const baDumTss = new Audio('/sfx/ba-dum-tss.mp3')
    baDumTss.preload = 'auto'
    baDumTssAudioRef.current = baDumTss
    return () => {
      haHa.src = ''
      baDumTss.src = ''
    }
  }, [])

  const clearRecordingTimeout = () => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
  }

  const clearResumeListenTimer = () => {
    if (resumeListenTimerRef.current) {
      window.clearTimeout(resumeListenTimerRef.current)
      resumeListenTimerRef.current = null
    }
  }

  const setConversationActiveBoth = (value) => {
    conversationActiveRef.current = value
    setConversationActive(value)
  }

  const teardownAnalyser = () => {
    setAnalyser(null)
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }

  // ── initial data ──
  useEffect(() => {
    fetch(`${API_BASE_URL}/`)
      .then((response) => {
        if (!response.ok) throw new Error('Backend status request failed')
        return response.json()
      })
      .then((data) => {
        setBackendStatus(data?.status === 'backend running' ? 'online' : 'offline')
      })
      .catch(() => setBackendStatus('offline'))
  }, [])

  useEffect(() => {
    fetch(`${API_BASE_URL}/models`)
      .then((response) => {
        if (!response.ok) throw new Error('Models request failed')
        return response.json()
      })
      .then((data) => {
        const availableModels = Array.isArray(data.models) ? data.models : []
        setModels(availableModels)
        setSelectedModel(data.default_model || availableModels[0] || '')
      })
      .catch(() => {
        setModels([])
        setSelectedModel('')
      })
  }, [])

  useEffect(() => {
    fetch(`${API_BASE_URL}/knowledge-bases`)
      .then((response) => {
        if (!response.ok) throw new Error('Knowledge bases request failed')
        return response.json()
      })
      .then((data) => {
        const returnedKnowledgeBases = Array.isArray(data)
          ? data
          : Array.isArray(data.knowledge_bases)
            ? data.knowledge_bases
            : Array.isArray(data.knowledgeBases)
              ? data.knowledgeBases
              : []
        const availableKnowledgeBases = returnedKnowledgeBases
          .map((knowledgeBase) => ({
            id: String(knowledgeBase?.id || ''),
            name: String(knowledgeBase?.name || knowledgeBase?.id || ''),
          }))
          .filter((knowledgeBase) => knowledgeBase.id && knowledgeBase.name)

        setKnowledgeBases(
          availableKnowledgeBases.length > 0 ? availableKnowledgeBases : FALLBACK_KNOWLEDGE_BASES,
        )
        setSelectedKnowledgeBase(
          availableKnowledgeBases.some((knowledgeBase) => knowledgeBase.id === 'none')
            ? 'none'
            : availableKnowledgeBases[0]?.id || 'none',
        )
      })
      .catch(() => {
        setKnowledgeBases(FALLBACK_KNOWLEDGE_BASES)
        setSelectedKnowledgeBase('none')
      })
  }, [])

  useEffect(() => {
    fetch(`${API_BASE_URL}/tts/voices`)
      .then((response) => {
        if (!response.ok) throw new Error('Voices request failed')
        return response.json()
      })
      .then((data) => {
        const returnedVoices = Array.isArray(data.voices) ? data.voices : []
        const availableVoices = returnedVoices
          .map((voice) => ({
            id: String(voice?.id || ''),
            name: String(voice?.name || voice?.id || ''),
            available: Boolean(voice?.available),
          }))
          .filter((voice) => voice.id && voice.name)
        const defaultVoiceId = String(data.default_voice_id || '')
        const defaultVoice = availableVoices.find(
          (voice) => voice.id === defaultVoiceId && voice.available,
        )
        const firstAvailableVoice = availableVoices.find((voice) => voice.available)
        setVoices(availableVoices)
        setSelectedVoiceId(defaultVoice?.id || firstAvailableVoice?.id || defaultVoiceId)
      })
      .catch(() => {
        setVoices([])
        setSelectedVoiceId('')
      })
  }, [])

  // ── unmount cleanup ──
  useEffect(
    () => () => {
      clearRecordingTimeout()
      clearResumeListenTimer()
      activeSpeechRef.current?.cleanup({ abortRequest: true, stopAudio: true })
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
    },
    [],
  )

  useEffect(() => {
    chatMessagesRef.current = chatMessages
  }, [chatMessages])

  useEffect(() => {
    autoSpeakRef.current = autoSpeak
  }, [autoSpeak])

  useEffect(() => {
    autoSendVoiceRef.current = autoSendVoice
  }, [autoSendVoice])

  // ── chat ──
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
        source_titles: Array.isArray(chatMessage.sources)
          ? chatMessage.sources
              .map((source) => String(source?.title || '').trim())
              .filter(Boolean)
              .slice(0, 5)
          : [],
      }))
      .filter((chatMessage) => chatMessage.content)
      .slice(-MAX_HISTORY_MESSAGES)

    setChatMessages((currentMessages) => [...currentMessages, { role: 'user', text: trimmedMessage }])
    setMessage('')
    setIsSending(true)
    setVoiceError('')

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmedMessage,
          history,
          model: trimmedModel,
          knowledge_base: selectedKnowledgeBase,
          temperature: safeTemperature,
          num_ctx: safeNumCtx,
        }),
      })

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      const data = await response.json()
      // Emotion contract: a reply may end with one emoticon (e.g. ":P");
      // it is stripped from the text/TTS and shown on the matrix instead.
      const { text: cleanedText, face } = extractReplyFace(data.reply || 'No reply received.')
      const messageId = nextChatMessageIdRef.current++
      const assistantMessage = {
        id: messageId,
        role: 'assistant',
        text: cleanedText,
        face,
        sfx: data.sfx || null,
        sources: Array.isArray(data.sources) ? data.sources : [],
        autoSpeak: autoSpeakRef.current,
      }

      if (face) {
        setReplyFace({ face, id: messageId })
      }
      setChatMessages((currentMessages) => [...currentMessages, assistantMessage])
    } catch {
      setConversationActiveBoth(false)
      setChatMessages((currentMessages) => [
        ...currentMessages,
        { role: 'assistant', text: 'Unable to reach the chat backend.' },
      ])
    } finally {
      setIsSending(false)
    }

    return true
  }

  // ── speech to text ──
  const transcribeAudio = async (audioBlob, { autoSend = false } = {}) => {
    setIsTranscribing(true)
    setVoiceError('')

    try {
      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const response = await fetch(`${API_BASE_URL}/stt`, {
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
        setUiMode('chat')
      }
    } catch {
      setConversationActiveBoth(false)
      setVoiceError("didn't catch that")
    } finally {
      setIsTranscribing(false)
    }
  }

  // ── recording ──
  const handleToggleRecording = async (mode = 'draft') => {
    const willAutoSend = mode === 'send' && autoSendVoiceRef.current

    if (isTranscribing || isSending || (willAutoSend && !selectedModel.trim())) {
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
      setVoiceError('audio recording is not supported in this browser')
      return
    }

    try {
      setVoiceError('')
      audioChunksRef.current = []
      discardRecordingRef.current = false

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = AUDIO_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingModeRef.current = mode
      setRecordingMode(mode)

      // feed the matrix visualizer
      try {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext
        const audioContext = new AudioContextCtor()
        const source = audioContext.createMediaStreamSource(stream)
        const analyserNode = audioContext.createAnalyser()
        analyserNode.fftSize = 128
        analyserNode.smoothingTimeConstant = 0.55
        source.connect(analyserNode)
        audioContextRef.current = audioContext
        setAnalyser(analyserNode)
      } catch {
        setAnalyser(null)
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const stoppedMode = recordingModeRef.current
        const discard = discardRecordingRef.current
        discardRecordingRef.current = false
        clearRecordingTimeout()
        setIsRecording(false)
        setRecordingMode(null)
        recordingModeRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        teardownAnalyser()

        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || 'audio/webm',
        })
        audioChunksRef.current = []

        if (discard) {
          return
        }

        if (audioBlob.size > 0) {
          transcribeAudio(audioBlob, {
            autoSend: stoppedMode === 'send' && autoSendVoiceRef.current,
          })
        } else {
          setConversationActiveBoth(false)
          setVoiceError('no audio was recorded')
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
      teardownAnalyser()
      setConversationActiveBoth(false)
      setVoiceError('unable to access the microphone')
    }
  }

  const cancelRecording = () => {
    if (!isRecording) return
    discardRecordingRef.current = true
    clearRecordingTimeout()
    mediaRecorderRef.current?.stop()
  }

  const stopActiveSpeech = () => {
    activeSpeechRef.current?.cleanup({ abortRequest: true, stopAudio: true })
  }

  // ── text to speech ──
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
    if (chatMessage.face) {
      setReplyFace({ face: chatMessage.face, id: `replay-${index}-${Date.now()}` })
    }

    const controller = new AbortController()
    let audio = null
    let audioUrl = ''
    let hasCleanedUp = false
    let playingTimeoutId = null
    const cleanupSpeakMessage = ({ abortRequest = false, stopAudio = false } = {}) => {
      if (hasCleanedUp) {
        return
      }
      hasCleanedUp = true

      if (playingTimeoutId !== null) {
        window.clearTimeout(playingTimeoutId)
        playingTimeoutId = null
      }

      if (abortRequest) {
        controller.abort()
      }

      if (audio) {
        audio.removeEventListener('error', cleanupSpeakMessage)
        if (stopAudio) {
          audio.pause()
          audio.currentTime = 0
          audio.removeAttribute('src')
          audio.load()
        }
      }

      // cancel an in-flight laugh
      if (laughRunRef.current) {
        laughRunRef.current.cancelled = true
        laughRunRef.current.audio?.pause()
        laughRunRef.current.finish?.()
        laughRunRef.current = null
      }
      setIsLaughing(false)

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
      const ttsPayload = { text: chatMessage.text, rate: speechRate }
      if (selectedVoiceId) {
        ttsPayload.voice_id = selectedVoiceId
      }

      const response = await fetch(`${API_BASE_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsPayload),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error('TTS request failed')
      }

      const audioBlob = await response.blob()
      audioUrl = URL.createObjectURL(audioBlob)
      audio = new Audio(audioUrl)

      // Play the ba-dum-tss rimshot (explicit corpus jokes only).
      const playBaDumTss = () => {
        const clip = baDumTssAudioRef.current
        if (!clip) return Promise.resolve()
        clip.currentTime = 0
        return new Promise((resolve) => {
          clip.addEventListener('ended', resolve, { once: true })
          clip.addEventListener('error', resolve, { once: true })
          clip.play().catch(resolve)
        })
      }

      // Joke contract: a reply tagged :D gets a brief beat → laugh animation in
      // sync with ha-ha-01.  LAUGH_AUDIO_ENABLED in identity.js is a kill switch.
      const playLaughClip = async () => {
        const run = { cancelled: false, audio: null, finish: null }
        laughRunRef.current = run

        await new Promise((resolve) => {
          run.finish = resolve
          window.setTimeout(resolve, LAUGH_PRE_BEAT_MS)
        })
        if (run.cancelled) return

        setIsLaughing(true)

        if (LAUGH_AUDIO_ENABLED && haHaAudioRef.current) {
          const haHa = haHaAudioRef.current
          haHa.currentTime = 0
          run.audio = haHa
          await new Promise((resolve) => {
            run.finish = resolve
            haHa.addEventListener('ended', resolve, { once: true })
            haHa.addEventListener('error', resolve, { once: true })
            haHa.play().catch(resolve)
          })
        } else {
          await new Promise((resolve) => {
            run.finish = resolve
            window.setTimeout(resolve, 1400)
          })
        }

        setIsLaughing(false)
        if (laughRunRef.current === run) {
          laughRunRef.current = null
        }
      }

      const handleNaturalEnd = async () => {
        if (chatMessage.face === ':D') {
          try {
            if (chatMessage.sfx === 'badumtss') {
              await playBaDumTss()
            }
            await playLaughClip()
          } catch {
            setIsLaughing(false)
            laughRunRef.current = null
          }
        }
        cleanupSpeakMessage()
        // Conversation loop: when a spoken reply finishes naturally,
        // go straight back to listening.
        if (conversationActiveRef.current && autoSendVoiceRef.current) {
          clearResumeListenTimer()
          resumeListenTimerRef.current = window.setTimeout(() => {
            handleToggleRecording('send')
          }, RESUME_LISTEN_DELAY_MS)
        }
      }

      audio.addEventListener('ended', handleNaturalEnd, { once: true })
      audio.addEventListener('error', cleanupSpeakMessage, { once: true })
      // Switch to speaking only when the first audio frame is audible.
      audio.addEventListener('playing', () => {
        if (playingTimeoutId !== null) {
          window.clearTimeout(playingTimeoutId)
          playingTimeoutId = null
        }
        if (!hasCleanedUp && activeSpeechRef.current?.cleanup === cleanupSpeakMessage) {
          setSpeechStatus('playing')
        }
      }, { once: true })
      // Unexpected mid-speech pause (OS interrupt, resource loss) — drop out
      // of speaking so the face can't get stuck in EQ mode.
      audio.addEventListener('pause', () => {
        if (!hasCleanedUp) {
          cleanupSpeakMessage()
        }
      }, { once: true })
      // Safety net: if 'playing' never fires (synthesis failure, hung /tts
      // response), bail out of 'loading' / thinking state after a timeout.
      playingTimeoutId = window.setTimeout(() => {
        playingTimeoutId = null
        if (!hasCleanedUp) {
          cleanupSpeakMessage()
        }
      }, TTS_START_TIMEOUT_MS)
      try {
        await audio.play()
        // Do NOT set speechStatus here — wait for the 'playing' event above,
        // which fires only when the first audio frame is actually audible.
      } catch (error) {
        cleanupSpeakMessage()
        throw error
      }
    } catch {
      cleanupSpeakMessage()
    }
  }

  // auto-speak fresh assistant replies
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages])

  // ── interaction handlers ──
  const endConversation = useCallback(() => {
    setConversationActiveBoth(false)
    clearResumeListenTimer()
    stopActiveSpeech()
    cancelRecording()
  }, [isRecording]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !settingsOpen) {
        endConversation()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [endConversation, settingsOpen])

  const handleMatrixPress = () => {
    markInteraction()
    setUiMode('voice')
    setVoiceError('')

    if (isRecording) {
      // "I'm done talking" — stop & send (or stop the dictation)
      mediaRecorderRef.current?.stop()
      return
    }
    if (isSending || isTranscribing) {
      return
    }
    if (speechStatus === 'playing' || speechStatus === 'loading') {
      stopActiveSpeech()
    }
    setConversationActiveBoth(true)
    handleToggleRecording('send')
  }

  const handleSendTyped = () => {
    markInteraction()
    sendChatMessage(message)
  }

  const handleDictate = () => {
    markInteraction()
    stopActiveSpeech()
    handleToggleRecording('draft')
  }

  const handleMessageChange = (value) => {
    markInteraction()
    setMessage(value)
  }

  const handleFocusInput = () => {
    markInteraction()
    setUiMode('chat')
  }

  // clicking any blank area collapses chat back to voice mode
  const handleShellPointerDown = (event) => {
    if (uiMode !== 'chat') return
    if (
      event.target.closest(
        'input, button, select, textarea, a, .chat-log, .chat-bar, .drawer-root',
      )
    ) {
      return
    }
    markInteraction()
    setUiMode('voice')
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }

  // ── derived ──
  const status = isRecording
    ? 'listening'
    : isTranscribing || isSending || speechStatus === 'loading'
      ? 'thinking'
      : speechStatus === 'playing'
        ? 'speaking'
        : 'idle'

  const statusDetail =
    status === 'listening'
      ? 'listening'
      : status === 'thinking'
        ? 'thinking'
        : status === 'speaking'
          ? 'speaking'
          : voiceError
            ? voiceError
            : !selectedModel.trim()
              ? 'no model selected — check settings'
              : conversationActive
                ? 'tap the grid to talk'
                : 'tap the grid to talk · or type below'

  const pressLabel =
    status === 'listening'
      ? 'Stop listening and send'
      : status === 'speaking'
        ? 'Interrupt and talk'
        : 'Start voice conversation'

  const canSend =
    message.trim().length > 0 && selectedModel.trim().length > 0 && !isSending && !isTranscribing

  return (
    <div className={`shell shell--${uiMode}`} onPointerDown={handleShellPointerDown}>
      <header className="shell-top">
        <button
          type="button"
          className="settings-button"
          onClick={() => {
            markInteraction()
            setSettingsOpen(true)
          }}
          aria-label="Open settings"
          title="Settings"
        >
          <GearIcon />
        </button>
        <div className="brand" title={`backend ${backendStatus}`}>
          <span className={`brand-dot brand-dot--${backendStatus}`} aria-hidden="true" />
          <span className="brand-name">{ASSISTANT_NAME.toLowerCase()}</span>
        </div>
      </header>

      <main className="stage">
        <MatrixStage
          status={status}
          statusDetail={statusDetail}
          analyser={analyser}
          replyFace={replyFace}
          laughing={isLaughing}
          hasError={Boolean(voiceError)}
          lastInteraction={lastInteraction}
          onPress={handleMatrixPress}
          pressLabel={pressLabel}
        />
        {conversationActive && status !== 'idle' ? (
          <button type="button" className="end-conversation" onClick={endConversation}>
            end conversation · esc
          </button>
        ) : null}
      </main>

      <footer className="dock">
        {uiMode === 'chat' ? (
          <ChatLog
            messages={chatMessages}
            onSpeak={handleSpeakMessage}
            speakingIndex={speakingMessageIndex}
          />
        ) : null}
        <ChatBar
          message={message}
          onMessageChange={handleMessageChange}
          onSend={handleSendTyped}
          onDictate={handleDictate}
          onFocusInput={handleFocusInput}
          isRecordingDraft={isRecording && recordingMode === 'draft'}
          isTranscribing={isTranscribing}
          isSending={isSending}
          canSend={canSend}
        />
      </footer>

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        models={models}
        selectedModel={selectedModel}
        onSelectedModelChange={setSelectedModel}
        voices={voices}
        selectedVoiceId={selectedVoiceId}
        onSelectedVoiceIdChange={setSelectedVoiceId}
        speechRate={speechRate}
        onSpeechRateChange={setSpeechRate}
        knowledgeBases={knowledgeBases}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSelectedKnowledgeBaseChange={setSelectedKnowledgeBase}
        temperature={temperature}
        onTemperatureChange={(value) =>
          setTemperature(clampFiniteNumber(value, MIN_TEMPERATURE, MAX_TEMPERATURE, DEFAULT_TEMPERATURE))
        }
        numCtx={numCtx}
        onNumCtxChange={(value) => setNumCtx(clampContextSize(value))}
        autoSpeak={autoSpeak}
        onAutoSpeakChange={setAutoSpeak}
        autoSendVoice={autoSendVoice}
        onAutoSendVoiceChange={setAutoSendVoice}
        backendStatus={backendStatus}
      />
    </div>
  )
}

export default App
