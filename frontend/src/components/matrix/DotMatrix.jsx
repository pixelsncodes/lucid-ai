import './matrix.css'
import {
  coord,
  faceDots,
  glyphDots,
  patternDots,
  rippleDelay,
  rowGradient,
  speakZone,
  SPEAK_DUR,
  SPEAK_DELAY,
} from './engine'

const DEFAULTS = {
  dotSize: 22,
  gap: 14,
  color: '#e4e2da',
  opBase: 0.13,
  opPeak: 1,
  opGrid: 0.09,
  cycleMs: 1500,
}

function buildDots(mode, value) {
  if (mode === 'face' || mode === 'speak') return faceDots(value)
  if (mode === 'glyph' || mode === 'ticker') return glyphDots(value)
  return patternDots(value)
}

/**
 * Presentational 5×5 dot matrix.
 * mode: 'face' | 'glyph' | 'pattern' | 'ticker' | 'speak'
 * anim (face/glyph/pattern): 'static' | 'talk' | 'ripple' | 'breathe'
 * eyesClosed: dims eye dots (JS-driven blinking)
 */
function DotMatrix({
  mode = 'face',
  value = ':)',
  anim = 'static',
  eyesClosed = false,
  dotSize = DEFAULTS.dotSize,
  gap = DEFAULTS.gap,
  color = DEFAULTS.color,
  opBase = DEFAULTS.opBase,
  opPeak = DEFAULTS.opPeak,
  opGrid = DEFAULTS.opGrid,
  cycleMs = DEFAULTS.cycleMs,
}) {
  const dots = buildDots(mode, value)
  const style = {
    '--ds': `${dotSize}px`,
    '--dg': `${gap}px`,
    '--ob': opBase,
    '--op': opPeak,
    '--og': opGrid,
    '--cy': `${Math.round(cycleMs)}ms`,
    '--dc': color,
  }

  if (mode === 'ticker') {
    return (
      <div className="dmx-grid" style={style} aria-hidden="true">
        {dots.map((_, i) => {
          const { row, col } = coord(i)
          return (
            <span
              key={`${value}-${i}`}
              className="dmx-dot tk"
              style={{
                backgroundImage: rowGradient(dots, row, color, opPeak, opGrid),
                '--x0': `${-col * dotSize}px`,
                '--x1': `${-(col + 5) * dotSize}px`,
              }}
            />
          )
        })}
      </div>
    )
  }

  if (mode === 'speak') {
    return (
      <div className="dmx-grid" style={style} aria-hidden="true">
        {dots.map((dot, i) => {
          const zone = speakZone(i)
          if (zone) {
            return (
              <span
                key={i}
                className={`dmx-dot ${zone.kind}`}
                style={{
                  animationDuration: `${SPEAK_DUR[zone.ci]}ms`,
                  '--d': `${SPEAK_DELAY[zone.ci] + (zone.kind === 'vu' ? -90 : 0)}ms`,
                }}
              />
            )
          }
          const lit = dot.active && dot.role !== 'm'
          const closed = eyesClosed && dot.role === 'e'
          return (
            <span
              key={i}
              className={`dmx-dot ${lit ? 'st' : 'off'}`}
              style={closed ? { opacity: opBase } : undefined}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="dmx-grid" style={style} aria-hidden="true">
      {dots.map((dot, i) => {
        let cls = 'off'
        let dotStyle
        if (dot.active) {
          if (anim === 'ripple') {
            cls = 'ar'
            dotStyle = { '--d': `-${rippleDelay(i, cycleMs)}ms` }
          } else if (anim === 'breathe') {
            cls = 'br'
          } else if (anim === 'talk' && dot.role === 'm') {
            cls = 'at'
          } else {
            cls = 'st'
          }
          if (eyesClosed && dot.role === 'e') {
            cls = 'st'
            dotStyle = { opacity: opBase }
          }
        }
        return <span key={i} className={`dmx-dot ${cls}`} style={dotStyle} />
      })}
    </div>
  )
}

export default DotMatrix
