import { useEffect, useRef, useState } from 'react'
import DotMatrix from './matrix/DotMatrix'
import MatrixVisualizer from './matrix/MatrixVisualizer'
import { LAUGH_FRAMES } from './matrix/engine'

const DEFAULT_FACE = ':)'
const BOOT_STEP_MS = 1500
const BOOT_CYCLE_MS = 1250
const SLEEP_AFTER_MS = 45000
const STARTLE_MS = 750
const FACE_LINGER_MS = 6000

/**
 * The assistant's face.
 * Boot: ticker-spells H, then I, then settles into a face.
 * Idle: :) with random blinks; falls asleep (breathing Z) when ignored,
 * wakes startled (O_O). Listening: audio-reactive VU. Thinking: diamond
 * ripple. Speaking: EQ mouth on the current face. Errors pull a :/ face.
 */
function MatrixStage({
  status = 'idle', // 'idle' | 'listening' | 'thinking' | 'speaking'
  statusDetail = '',
  analyser = null,
  replyFace = null, // { face, id }
  laughing = false,
  hasError = false,
  lastInteraction = 0,
  onPress,
  pressLabel = 'Start voice conversation',
  subtitleWindow = null, // { prev, current, next } | null
}) {
  const [bootPhase, setBootPhase] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'live' : 'boot-h',
  )
  const [asleep, setAsleep] = useState(false)
  const [startled, setStartled] = useState(false)
  const [eyesClosed, setEyesClosed] = useState(false)
  const [face, setFace] = useState(DEFAULT_FACE)
  const [laughFrame, setLaughFrame] = useState(0)
  const prevInteractionRef = useRef(lastInteraction)
  const startleTimerRef = useRef(null)

  // any real activity cuts the boot short
  const phase = status !== 'idle' ? 'live' : bootPhase

  // ── boot sequence: H → I → live ──
  useEffect(() => {
    if (bootPhase === 'live') return undefined
    const t1 = window.setTimeout(() => setBootPhase('boot-i'), BOOT_STEP_MS)
    const t2 = window.setTimeout(() => setBootPhase('live'), BOOT_STEP_MS * 2)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── random blinking while idle ──
  useEffect(() => {
    if (phase !== 'live' || asleep || status !== 'idle') return undefined
    let cancelled = false
    const timers = []
    const later = (fn, ms) => {
      const t = window.setTimeout(() => {
        if (!cancelled) fn()
      }, ms)
      timers.push(t)
    }
    const blinkOnce = (after) => {
      later(() => {
        setEyesClosed(true)
        later(() => {
          setEyesClosed(false)
          if (Math.random() < 0.14) {
            // occasional double blink
            later(() => {
              setEyesClosed(true)
              later(() => {
                setEyesClosed(false)
                blinkOnce(2200 + Math.random() * 4600)
              }, 120)
            }, 140)
          } else {
            blinkOnce(2200 + Math.random() * 4600)
          }
        }, 130)
      }, after)
    }
    blinkOnce(1400 + Math.random() * 2600)
    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
      setEyesClosed(false)
    }
  }, [phase, asleep, status])

  // ── falling asleep ──
  useEffect(() => {
    if (phase !== 'live' || status !== 'idle' || asleep) return undefined
    const remaining = Math.max(0, lastInteraction + SLEEP_AFTER_MS - Date.now())
    const t = window.setTimeout(() => setAsleep(true), remaining)
    return () => window.clearTimeout(t)
  }, [phase, status, asleep, lastInteraction])

  // ── waking up (startled) ──
  useEffect(() => {
    const interacted = lastInteraction !== prevInteractionRef.current
    prevInteractionRef.current = lastInteraction
    if (!asleep) return
    if (interacted || status !== 'idle') {
      setAsleep(false)
      setStartled(true)
      window.clearTimeout(startleTimerRef.current)
      startleTimerRef.current = window.setTimeout(() => setStartled(false), STARTLE_MS)
    }
  }, [lastInteraction, status, asleep])

  useEffect(() => () => window.clearTimeout(startleTimerRef.current), [])

  // ── reply emotions ──
  useEffect(() => {
    if (!replyFace?.face) return undefined
    const t = window.setTimeout(() => setFace(replyFace.face), 0)
    return () => window.clearTimeout(t)
  }, [replyFace])

  useEffect(() => {
    if (status !== 'idle' || face === DEFAULT_FACE) return undefined
    const t = window.setTimeout(() => setFace(DEFAULT_FACE), FACE_LINGER_MS)
    return () => window.clearTimeout(t)
  }, [status, face])

  // ── laugh frame cycling ──
  useEffect(() => {
    if (!laughing) return undefined
    const id = window.setInterval(() => {
      setLaughFrame((frame) => (frame + 1) % LAUGH_FRAMES.length)
    }, 190)
    return () => window.clearInterval(id)
  }, [laughing])

  // ── pick what to draw ──
  let display
  let statusText = statusDetail
  if (phase !== 'live') {
    display = <DotMatrix mode="ticker" value={phase === 'boot-h' ? 'H' : 'I'} cycleMs={BOOT_CYCLE_MS} />
    statusText = 'booting'
  } else if (laughing) {
    display = <DotMatrix mode="face" value={LAUGH_FRAMES[laughFrame]} />
    statusText = 'ha ha'
  } else if (status === 'listening') {
    display = <MatrixVisualizer analyser={analyser} />
  } else if (status === 'thinking') {
    display = <DotMatrix mode="pattern" value="diamond" anim="ripple" cycleMs={1150} />
  } else if (status === 'speaking') {
    display = <DotMatrix mode="speak" value={face} />
    if (subtitleWindow) {
      statusText = (
        <span className="matrix-subtitle">
          <span className="subtitle-prev">{subtitleWindow.prev ?? ' '}</span>
          {' '}
          <span className="subtitle-cur">{subtitleWindow.current}</span>
          {' '}
          <span className="subtitle-next">{subtitleWindow.next ?? ' '}</span>
        </span>
      )
    }
  } else if (asleep) {
    display = <DotMatrix mode="glyph" value="Z" anim="breathe" />
    statusText = 'zzz'
  } else if (startled) {
    display = <DotMatrix mode="face" value="O_O" />
  } else {
    display = <DotMatrix mode="face" value={hasError ? ':/' : face} eyesClosed={eyesClosed} />
  }

  return (
    <div className="matrix-stage">
      <button type="button" className="matrix-button" onClick={onPress} aria-label={pressLabel}>
        <span className="matrix-frame">{display}</span>
      </button>
      <p className="matrix-status" aria-live="polite">
        {statusText}
      </p>
    </div>
  )
}

export default MatrixStage
