import { useEffect, useRef } from 'react'
import './matrix.css'

const COLS = 5
const ROWS = 5
// frequency bands per column (analyser fftSize 128 → 64 bins);
// skip bin 0 (DC/rumble), widen + boost toward the highs where
// voice carries less energy — like a real spectrum analyzer
const BANDS = [
  [1, 2],
  [3, 5],
  [6, 10],
  [11, 18],
  [19, 31],
]
const GAINS = [0.85, 1.1, 1.45, 1.85, 2.3]
const PEAK_DECAY = 0.055
const RELEASE = 0.8

/**
 * Audio-reactive EQ on the 5×5 grid — solid bars with a bright
 * head and a slow-falling peak-hold cap, lit bottom-up per column.
 * Falls back to gentle synthetic motion when no analyser exists.
 * Dot opacities are mutated imperatively — no per-frame React renders.
 */
function MatrixVisualizer({
  analyser = null,
  dotSize = 22,
  gap = 14,
  color = '#e4e2da',
  opBase = 0.13,
  opPeak = 1,
}) {
  const dotRefs = useRef([])

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let rafId = 0
    const freqData = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    const levels = [0, 0, 0, 0, 0]
    const peaks = [0, 0, 0, 0, 0]

    const paint = () => {
      for (let c = 0; c < COLS; c++) {
        const barTop = Math.round(levels[c]) // 0..5 dots lit from the bottom
        const peakPos = peaks[c] > 0.55 ? Math.min(ROWS, Math.max(1, Math.round(peaks[c]))) : 0
        for (let r = 0; r < ROWS; r++) {
          const dot = dotRefs.current[r * COLS + c]
          if (!dot) continue
          const pos = ROWS - r // 1 (bottom) .. 5 (top)
          let opacity = opBase
          if (pos <= barTop) {
            opacity = pos === barTop ? opPeak : opPeak * 0.5 // bright head, solid body
          } else if (pos === peakPos) {
            opacity = opPeak * 0.9 // falling peak cap
          }
          dot.style.opacity = opacity
        }
      }
    }

    if (reduceMotion) {
      levels[0] = 2
      levels[1] = 3
      levels[2] = 4
      levels[3] = 3
      levels[4] = 2
      paint()
      return undefined
    }

    const tick = (now) => {
      for (let c = 0; c < COLS; c++) {
        let target
        if (analyser && freqData) {
          analyser.getByteFrequencyData(freqData)
          const [from, to] = BANDS[c]
          let sum = 0
          for (let k = from; k <= to; k++) sum += freqData[k]
          const raw = Math.min(1, (sum / (to - from + 1) / 255) * GAINS[c] * 1.5)
          target = Math.pow(raw, 0.72) * ROWS
        } else {
          // synthetic fallback — slow independent column drift
          target = 1.4 + 1.8 * Math.abs(Math.sin(now / (430 + c * 117) + c * 1.7))
        }
        // fast attack, slow release
        levels[c] = target > levels[c] ? levels[c] + (target - levels[c]) * 0.72 : levels[c] * RELEASE
        // peak cap falls slowly, snaps up with the bar
        peaks[c] = Math.max(levels[c], peaks[c] - PEAK_DECAY)
      }
      paint()
      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [analyser, opBase, opPeak])

  return (
    <div
      className="dmx-grid"
      style={{
        '--ds': `${dotSize}px`,
        '--dg': `${gap}px`,
        '--dc': color,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: COLS * ROWS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            dotRefs.current[i] = el
          }}
          className="dmx-dot"
          style={{ opacity: opBase }}
        />
      ))}
    </div>
  )
}

export default MatrixVisualizer
