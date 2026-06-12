import { forwardRef, useImperativeHandle, useRef } from 'react'
import './GameGrid.css'
import { DOT_COLOR, DOT_SIZE, DOT_GAP, OP_OFF, OP_DIM, OP_LIT } from './constants'

/**
 * NxM dot-matrix game grid. Uses the same visual constants as DotMatrix.
 *
 * Rendering is imperative: the parent calls ref.setDots(flat Uint8Array)
 * each frame to avoid 60fps React re-renders. Dot state values:
 *   0 = OFF  (background)
 *   1 = DIM  (walls, dividers, score pips)
 *   2 = LIT  (ball, active paddle, score, countdown)
 */
const GameGrid = forwardRef(function GameGrid(
  {
    cols    = 16,
    rows    = 16,
    dotSize = DOT_SIZE,
    gap     = DOT_GAP,
    color   = DOT_COLOR,
  },
  ref,
) {
  const containerRef = useRef(null)
  const prevRef      = useRef(null)

  useImperativeHandle(ref, () => ({
    setDots(dots) {
      const el = containerRef.current
      if (!el) return
      const spans = el.children
      const prev  = prevRef.current
      const n     = Math.min(dots.length, spans.length)
      for (let i = 0; i < n; i++) {
        const s = dots[i]
        if (prev !== null && prev[i] === s) continue
        const cls =
          s === 2 ? 'gg-dot gg-dot--lit' :
          s === 1 ? 'gg-dot gg-dot--dim' :
                    'gg-dot gg-dot--off'
        if (spans[i].className !== cls) spans[i].className = cls
      }
      if (!prevRef.current || prevRef.current.length !== n) {
        prevRef.current = new Uint8Array(n)
      }
      prevRef.current.set(dots.subarray ? dots.subarray(0, n) : Array.from(dots).slice(0, n))
    },
  }), [])

  const style = {
    '--gg-ds':  `${dotSize}px`,
    '--gg-dg':  `${gap}px`,
    '--gg-dc':  color,
    '--gg-off': OP_OFF,
    '--gg-dim': OP_DIM,
    '--gg-lit': OP_LIT,
    gridTemplateColumns: `repeat(${cols}, ${dotSize}px)`,
  }

  return (
    <div ref={containerRef} className="gg-grid" style={style} aria-hidden="true">
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} className="gg-dot gg-dot--off" />
      ))}
    </div>
  )
})

export default GameGrid
