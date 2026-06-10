import './dotmatrix-loader.css'

import { useDotMatrixPhases, usePrefersReducedMotion } from './dotmatrix-hooks'
const DOT_MATRIX_COLOR_PRESETS = {
  "solid-theme": {
    fill: "var(--color-dot-on)",
    glow: "var(--color-dot-on)"
  },
  "solid-mint": {
    fill: "#34d399",
    glow: "#34d399"
  },
  "grad-sunset": {
    fill: "linear-gradient(135deg, #ff5f6d 0%, #ffc371 52%, #ffe29a 100%)",
    glow: "#ff8b73"
  },
  "grad-ocean": {
    fill: "linear-gradient(140deg, #00c6ff 0%, #0072ff 48%, #4facfe 100%)",
    glow: "#2f8fff"
  },
  "grad-neon": {
    fill: "linear-gradient(145deg, #b4ff39 0%, #39ffb6 46%, #00d4ff 100%)",
    glow: "#59ffc8"
  },
  "grad-aurora": {
    fill: "linear-gradient(145deg, #ff3cac 0%, #784ba0 45%, #2b86c5 100%)",
    glow: "#9c64bf"
  },
  "grad-fire": {
    fill: "linear-gradient(145deg, #ff512f 0%, #dd2476 45%, #ffb347 100%)",
    glow: "#f96a5f"
  },
  "grad-prism": {
    fill: "linear-gradient(145deg, #12c2e9 0%, #c471ed 45%, #f64f59 100%)",
    glow: "#9e7de8"
  }
}
export function resolveDmxColorTokens(color, colorPreset) {
  if (!colorPreset) {
    return {
      resolvedColor: color,
      dotFill: color
    }
  }
  const preset = DOT_MATRIX_COLOR_PRESETS[colorPreset]
  if (!preset) {
    return {
      resolvedColor: color,
      dotFill: color
    }
  }
  return {
    resolvedColor: preset.glow,
    dotFill: preset.fill
  }
}
export function cx(...values) {
  return values.filter(Boolean).join(" ")
}
export const MATRIX_SIZE = 5
const CENTER = Math.floor(MATRIX_SIZE / 2)
const RANGE = Array.from({
  length: MATRIX_SIZE
}, (_, index) => index)
const MAX_RADIUS = Math.hypot(CENTER, CENTER)
export const FULL_INDEXES = RANGE.flatMap(row => RANGE.map(col => rowMajorIndex(row, col)))
export const DIAMOND_INDEXES = FULL_INDEXES.filter(index => {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.abs(row - CENTER) + Math.abs(col - CENTER) <= 2
})
export const OUTLINE_INDEXES = FULL_INDEXES.filter(index => {
  const {
    row,
    col
  } = indexToCoord(index)
  return row === 0 || row === MATRIX_SIZE - 1 || col === 0 || col === MATRIX_SIZE - 1
})
export const CROSS_INDEXES = FULL_INDEXES.filter(index => {
  const {
    row,
    col
  } = indexToCoord(index)
  return row === CENTER || col === CENTER
})
export const RINGS_INDEXES = FULL_INDEXES.filter(index => {
  const {
    row,
    col
  } = indexToCoord(index)
  const radius = Math.hypot(row - CENTER, col - CENTER)
  return Math.round(radius) === 1 || Math.round(radius) === 2
})
export const ROSE_INDEXES = FULL_INDEXES.filter(index => {
  const {
    row,
    col
  } = indexToCoord(index)
  const dx = col - CENTER
  const dy = row - CENTER
  const angle = Math.atan2(dy, dx)
  const radius = Math.hypot(dx, dy)
  const rose = Math.abs(Math.sin(3 * angle))
  return rose > 0.6 && radius >= 1
})
const PATTERN_INDEXES = {
  diamond: DIAMOND_INDEXES,
  full: FULL_INDEXES,
  outline: OUTLINE_INDEXES,
  rose: ROSE_INDEXES,
  cross: CROSS_INDEXES,
  rings: RINGS_INDEXES
}
export function getPatternIndexes(pattern = "diamond") {
  return PATTERN_INDEXES[pattern]
}
export function rowMajorIndex(row, col) {
  return row * MATRIX_SIZE + col
}
export function indexToCoord(index) {
  return {
    row: Math.floor(index / MATRIX_SIZE),
    col: index % MATRIX_SIZE
  }
}
export function distanceFromCenter(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.hypot(row - CENTER, col - CENTER)
}
export function rowDistance(index) {
  const {
    row
  } = indexToCoord(index)
  return Math.abs(row - CENTER)
}
export function polarAngle(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.atan2(row - CENTER, col - CENTER)
}
export function normalizedRadius(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.hypot(row - CENTER, col - CENTER) / MAX_RADIUS
}
export function manhattanDistance(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.abs(row - CENTER) + Math.abs(col - CENTER)
}
export function harmonicPhase(row, col, a, b) {
  return Math.sin((row + 1) * a + (col + 1) * b)
}
export function lissajousOffset(row, col, amplitude = 2.25) {
  const x = Math.sin((row + 1) * 1.15 + (col + 1) * 2.2) * amplitude
  const y = Math.cos((row + 1) * 2.45 + (col + 1) * 0.95) * amplitude
  const phase = Math.abs(Math.sin((row + 1) * 0.7 + (col + 1) * 1.1))
  return {
    x,
    y,
    phase
  }
}
export function spiralOffset(angle, radiusNormalizedValue, amplitude = 2.8) {
  const spin = angle + radiusNormalizedValue * Math.PI * 2.1
  const radius = radiusNormalizedValue * amplitude
  const x = Math.cos(spin) * radius
  const y = Math.sin(spin) * radius
  const phase = Math.abs(Math.sin(spin * 0.5))
  return {
    x,
    y,
    phase
  }
}
export function isPrime(value) {
  if (value <= 1) {
    return false
  }
  if (value === 2) {
    return true
  }
  if (value % 2 === 0) {
    return false
  }
  const limit = Math.floor(Math.sqrt(value))
  for (let divisor = 3; divisor <= limit; divisor += 2) {
    if (value % divisor === 0) {
      return false
    }
  }
  return true
}
const N = MATRIX_SIZE
const C = Math.floor(MATRIX_SIZE / 2)
const CELLS = N * N
const MAX_TRBL = (N - 1) * 2
export function trBlPathNormFromIndex(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return (row + (N - 1 - col)) / MAX_TRBL
}
function buildSnakeOrderToIndexMap() {
  const pathOrder = new Array(CELLS)
  const key = (row, col) => rowMajorIndex(row, col)
  let t = 0
  for (let row = 0; row < N; row += 1) {
    if (row % 2 === 0) {
      for (let col = 0; col < N; col += 1) {
        pathOrder[key(row, col)] = t
        t += 1
      }
    } else {
      for (let col = N - 1; col >= 0; col -= 1) {
        pathOrder[key(row, col)] = t
        t += 1
      }
    }
  }
  return pathOrder
}
const SNAKE_ORDER = buildSnakeOrderToIndexMap()
export function snakePathNormFromIndex(index) {
  return SNAKE_ORDER[index] / (CELLS - 1)
}
export function snakePathOrderValue(index) {
  return SNAKE_ORDER[index]
}
function buildSpiralInwardOrderToIndexMap() {
  const order = new Array(CELLS)
  let top = 0
  let bottom = N - 1
  let left = 0
  let right = N - 1
  let t = 0
  while (top <= bottom && left <= right) {
    for (let col = left; col <= right; col += 1) {
      order[rowMajorIndex(top, col)] = t
      t += 1
    }
    for (let row = top + 1; row <= bottom; row += 1) {
      order[rowMajorIndex(row, right)] = t
      t += 1
    }
    if (top < bottom) {
      for (let col = right - 1; col >= left; col -= 1) {
        order[rowMajorIndex(bottom, col)] = t
        t += 1
      }
    }
    if (left < right) {
      for (let row = bottom - 1; row > top; row -= 1) {
        order[rowMajorIndex(row, left)] = t
        t += 1
      }
    }
    top += 1
    bottom -= 1
    left += 1
    right -= 1
  }
  return order
}
const SPIRAL_INWARD_ORDER = buildSpiralInwardOrderToIndexMap()
export function spiralInwardNormFromIndex(index) {
  return SPIRAL_INWARD_ORDER[index] / (CELLS - 1)
}
export function spiralInwardOrderValue(index) {
  return SPIRAL_INWARD_ORDER[index]
}
function buildOuterRingClockwiseOrderToIndexMap() {
  const order = new Array(CELLS).fill(-1)
  const coords = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [3, 0], [2, 0], [1, 0]]
  for (let t = 0; t < coords.length; t += 1) {
    const [row, col] = coords[t]
    order[rowMajorIndex(row, col)] = t
  }
  return order
}
function buildMiddleRingAntiClockwiseOrderToIndexMap() {
  const order = new Array(CELLS).fill(-1)
  const coords = [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]]
  for (let t = 0; t < coords.length; t += 1) {
    const [row, col] = coords[t]
    order[rowMajorIndex(row, col)] = t
  }
  return order
}
const OUTER_RING_CLOCKWISE_ORDER = buildOuterRingClockwiseOrderToIndexMap()
const MIDDLE_RING_ANTI_CLOCKWISE_ORDER = buildMiddleRingAntiClockwiseOrderToIndexMap()
export function outerRingClockwiseOrderValue(index) {
  return OUTER_RING_CLOCKWISE_ORDER[index]
}
export function outerRingClockwiseNormFromIndex(index) {
  const order = outerRingClockwiseOrderValue(index)
  return order >= 0 ? order / 15 : 0
}
export function middleRingAntiClockwiseOrderValue(index) {
  return MIDDLE_RING_ANTI_CLOCKWISE_ORDER[index]
}
export function middleRingAntiClockwiseNormFromIndex(index) {
  const order = middleRingAntiClockwiseOrderValue(index)
  return order >= 0 ? order / 7 : 0
}
function buildDiagonalSnakeOrderToIndexMap() {
  const order = new Array(CELLS)
  let t = 0
  for (let diagonal = 0; diagonal <= (N - 1) * 2; diagonal += 1) {
    const rowStart = Math.max(0, diagonal - (N - 1))
    const rowEnd = Math.min(N - 1, diagonal)
    if (diagonal % 2 === 0) {
      for (let row = rowEnd; row >= rowStart; row -= 1) {
        const col = diagonal - row
        order[rowMajorIndex(row, col)] = t
        t += 1
      }
    } else {
      for (let row = rowStart; row <= rowEnd; row += 1) {
        const col = diagonal - row
        order[rowMajorIndex(row, col)] = t
        t += 1
      }
    }
  }
  return order
}
const DIAGONAL_SNAKE_ORDER = buildDiagonalSnakeOrderToIndexMap()
export function diagonalSnakeOrderValue(index) {
  return DIAGONAL_SNAKE_ORDER[index]
}
export function diagonalSnakeNormFromIndex(index) {
  return DIAGONAL_SNAKE_ORDER[index] / (CELLS - 1)
}
function buildRowWaveSnakeOrderToIndexMap() {
  const order = new Array(CELLS)
  const route = [{
    col: 0,
    dir: "up"
  }, {
    col: 2,
    dir: "down"
  }, {
    col: 1,
    dir: "up"
  }, {
    col: 3,
    dir: "down"
  }, {
    col: 2,
    dir: "up"
  }, {
    col: 4,
    dir: "down"
  }]
  let t = 0
  for (const step of route) {
    if (step.dir === "up") {
      for (let row = N - 1; row >= 0; row -= 1) {
        order[rowMajorIndex(row, step.col)] = t
        t += 1
      }
    } else {
      for (let row = 0; row < N; row += 1) {
        order[rowMajorIndex(row, step.col)] = t
        t += 1
      }
    }
  }
  return order
}
const ROW_WAVE_SNAKE_ORDER = buildRowWaveSnakeOrderToIndexMap()
const ROW_WAVE_SNAKE_MAX_ORDER = Math.max(...ROW_WAVE_SNAKE_ORDER)
export function rowWaveOrderValue(index) {
  return ROW_WAVE_SNAKE_ORDER[index]
}
export function rowWaveNormFromIndex(index) {
  return ROW_WAVE_SNAKE_MAX_ORDER > 0 ? rowWaveOrderValue(index) / ROW_WAVE_SNAKE_MAX_ORDER : 0
}
export function colWaveNormFromIndex(index) {
  const {
    col
  } = indexToCoord(index)
  return N > 1 ? col / (N - 1) : 0
}
export function concentricRingNormFromIndex(index) {
  const {
    row,
    col
  } = indexToCoord(index)
  return Math.max(Math.abs(row - C), Math.abs(col - C)) / C
}
const CORNER_COORDS = new Set(["0,0", "0,4", "4,0", "4,4"])
export function isWithinCircularMask(row, col) {
  return !CORNER_COORDS.has(`${row},${col}`)
}
export function stylePx(n) {
  return `${n}px`
}
export function styleOpacity(opacity) {
  return Math.round(opacity * 1e6) / 1e6
}
const SOURCE_BASE_OPACITY = 0.08
const SOURCE_MID_OPACITY = 0.34
const SOURCE_PEAK_OPACITY = 0.94
function lerpDmx(start, end, progress) {
  return start + (end - start) * progress
}
function normalizeProgressDmx(value, start, end) {
  const span = end - start
  if (Math.abs(span) < Number.EPSILON) {
    return 0
  }
  return Math.min(1, Math.max(0, (value - start) / span))
}
function coerceOpacityDmx(value) {
  if (value == null || !Number.isFinite(value)) {
    return undefined
  }
  return Math.min(1, Math.max(0, value))
}
export function remapOpacityToTriplet(opacity, opacityBase, opacityMid, opacityPeak) {
  if (!Number.isFinite(opacity)) {
    return opacity
  }
  const hasOverrides = opacityBase !== undefined || opacityMid !== undefined || opacityPeak !== undefined
  const safeOpacity = Math.min(1, Math.max(0, opacity))
  if (!hasOverrides) {
    return safeOpacity
  }
  const targetBase = coerceOpacityDmx(opacityBase) ?? SOURCE_BASE_OPACITY
  const targetMid = coerceOpacityDmx(opacityMid) ?? SOURCE_MID_OPACITY
  const targetPeak = coerceOpacityDmx(opacityPeak) ?? SOURCE_PEAK_OPACITY
  if (safeOpacity <= SOURCE_BASE_OPACITY) {
    const progress = normalizeProgressDmx(safeOpacity, 0, SOURCE_BASE_OPACITY)
    return Math.min(1, Math.max(0, lerpDmx(0, targetBase, progress)))
  }
  if (safeOpacity <= SOURCE_MID_OPACITY) {
    const progress = normalizeProgressDmx(safeOpacity, SOURCE_BASE_OPACITY, SOURCE_MID_OPACITY)
    return Math.min(1, Math.max(0, lerpDmx(targetBase, targetMid, progress)))
  }
  if (safeOpacity <= SOURCE_PEAK_OPACITY) {
    const progress = normalizeProgressDmx(safeOpacity, SOURCE_MID_OPACITY, SOURCE_PEAK_OPACITY)
    return Math.min(1, Math.max(0, lerpDmx(targetMid, targetPeak, progress)))
  }
  const progress = normalizeProgressDmx(safeOpacity, SOURCE_PEAK_OPACITY, 1)
  return Math.min(1, Math.max(0, lerpDmx(targetPeak, 1, progress)))
}

/** Remapped opacity where bloom begins (weakest glow); scales linearly to full bloom at 1. */
export const DMX_BLOOM_OPACITY_MIN = 0.6
export function opacityToBloomLevel(remappedOpacity) {
  return Math.max(0, Math.min(1, (remappedOpacity - DMX_BLOOM_OPACITY_MIN) / (1 - DMX_BLOOM_OPACITY_MIN)))
}
export function remappedOpacityQualifiesForBloom(remappedOpacity) {
  return remappedOpacity >= DMX_BLOOM_OPACITY_MIN
}
function clampHalo(value) {
  if (value == null || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}
export function dmxBloomRootActive(bloom, halo) {
  return bloom || clampHalo(halo) > 0
}

/** Root class when `halo` > 0 — CSS widens drop-shadow falloff for a softer, more diffuse glow. */
export function dmxBloomHaloSpreadClass(halo) {
  return clampHalo(halo) > 0 ? "dmx-bloom-halo" : false
}

/**
 * Bloom level and dot class for one cell. `curveOpacity` is the loader’s logical opacity **before**
 * `remapOpacityToTriplet` (same as `bloom` uses today).
 */
export function dmxDotBloomParts(isActive, curveOpacity, bloom, halo, ob, om, op) {
  const haloN = clampHalo(halo)
  if (!isActive) {
    return {
      level: 0,
      bloomDot: false
    }
  }
  const remapped = remapOpacityToTriplet(curveOpacity, ob, om, op)
  const fromBloom = bloom ? opacityToBloomLevel(remapped) : 0
  return {
    level: fromBloom,
    bloomDot: haloN > 0 || bloom && remappedOpacityQualifiesForBloom(remapped)
  }
}
function getMatrix5Layout(size, dotSize, cellPadding) {
  const n = MATRIX_SIZE
  if (cellPadding != null) {
    const g = Math.max(0, cellPadding)
    const matrixSpan = dotSize * n + g * (n - 1)
    return {
      gap: g,
      matrixSpan
    }
  }
  const g = Math.max(1, Math.floor((size - dotSize * n) / (n - 1)))
  return {
    gap: g,
    matrixSpan: size
  }
}
function resolveDmxBoxOuterDim(options) {
  const b = options?.boxSize
  const hasBox = b != null && b > 0 && Number.isFinite(b)
  if (!hasBox) {
    return {
      outerDim: 0,
      useWrapper: false
    }
  }
  const m = options?.minSize
  if (m != null && m > 0 && Number.isFinite(m)) {
    return {
      outerDim: Math.max(b, m),
      useWrapper: true
    }
  }
  return {
    outerDim: b,
    useWrapper: true
  }
}
function clamp01Dmx(n) {
  if (n == null) {
    return
  }
  if (!Number.isFinite(n)) {
    return
  }
  return Math.min(1, Math.max(0, n))
}
export function DotMatrixBase({
  size = 24,
  dotSize = 3,
  color = "currentColor",
  colorPreset,
  speed = 1,
  ariaLabel = "Loading",
  className,
  pattern = "diamond",
  dotShape = "circle",
  muted = false,
  bloom = false,
  halo = 0,
  dotClassName,
  phase,
  reducedMotion = false,
  onMouseEnter,
  onMouseLeave,
  animationResolver,
  opacityBase,
  opacityMid,
  opacityPeak,
  cellPadding,
  boxSize,
  minSize,
  style,
  'aria-label': ariaLabelProp
}) {
  const patternIndexes = new Set(getPatternIndexes(pattern))
  const safeSpeed = speed > 0 ? speed : 1
  const speedScale = 1 / safeSpeed
  const {
    gap,
    matrixSpan
  } = getMatrix5Layout(size, dotSize, cellPadding)
  const {
    outerDim,
    useWrapper
  } = resolveDmxBoxOuterDim({
    boxSize,
    minSize
  })
  const scale = useWrapper && matrixSpan > 0 ? outerDim / matrixSpan : 1
  const center = Math.floor(MATRIX_SIZE / 2)
  const ob = clamp01Dmx(opacityBase)
  const om = clamp01Dmx(opacityMid)
  const op = clamp01Dmx(opacityPeak)
  const unit = dotSize + gap
  const {
    resolvedColor,
    dotFill
  } = resolveDmxColorTokens(color, colorPreset)
  const resolvedAriaLabel = ariaLabelProp || ariaLabel
  const dmxVarStyle = {
    width: matrixSpan,
    height: matrixSpan,
    "--dmx-speed": speedScale,
    ["--dmx-dot-size"]: `${dotSize}px`,
    ["--dmx-halo-level"]: halo,
    ["--dmx-dot-fill"]: dotFill,
    color: resolvedColor,
    ...(ob !== undefined && {
      ["--dmx-opacity-base"]: ob
    }),
    ...(om !== undefined && {
      ["--dmx-opacity-mid"]: om
    }),
    ...(op !== undefined && {
      ["--dmx-opacity-peak"]: op
    }),
    ...(useWrapper ? {
      transform: `scale(${scale})`,
      transformOrigin: "center center"
    } : {
      minWidth: minSize,
      minHeight: minSize
    }),
    ...(!useWrapper ? style : {})
  }
  const dots = Array.from({
    length: MATRIX_SIZE * MATRIX_SIZE
  }).map((_, index) => {
    const {
      row,
      col
    } = indexToCoord(index)
    const isActive = patternIndexes.has(index)
    const distance = distanceFromCenter(index)
    const angle = polarAngle(index)
    const radiusNormalizedValue = normalizedRadius(index)
    const manhattan = manhattanDistance(index)
    const deltaX = (col - center) * unit
    const deltaY = (row - center) * unit
    const animationState = animationResolver ? animationResolver({
      index,
      row,
      col,
      distanceFromCenter: distance,
      angleFromCenter: angle,
      radiusNormalized: radiusNormalizedValue,
      manhattanDistance: manhattan,
      phase,
      isActive,
      reducedMotion
    }) : {}
    const resolvedAnimationStyle = animationState.style ? {
      ...animationState.style
    } : undefined
    let isBloomDot = false
    let stylePatch = resolvedAnimationStyle
    if (isActive) {
      const rawOpacity = stylePatch?.opacity
      if (stylePatch != null && typeof rawOpacity === "number") {
        const remappedOpacity = remapOpacityToTriplet(rawOpacity, ob, om, op)
        stylePatch = {
          ...stylePatch,
          opacity: remappedOpacity
        }
        const parts = dmxDotBloomParts(true, rawOpacity, bloom, halo, ob, om, op)
        stylePatch["--dmx-bloom-level"] = parts.level
        isBloomDot = parts.bloomDot
      } else {
        const parts = dmxDotBloomParts(true, 0, bloom, halo, ob, om, op)
        if (parts.level > 0) {
          stylePatch = {
            ...(stylePatch ?? {}),
            ["--dmx-bloom-level"]: parts.level
          }
        }
        isBloomDot = parts.bloomDot
      }
    }
    const dotStyle = {
      width: dotSize,
      height: dotSize,
      "--dmx-distance": distance,
      "--dmx-row": row,
      "--dmx-col": col,
      "--dmx-x": `${deltaX}px`,
      "--dmx-y": `${deltaY}px`,
      "--dmx-angle": angle,
      "--dmx-radius": radiusNormalizedValue,
      "--dmx-manhattan": manhattan,
      ...stylePatch,
      ...(!isActive ? {
        opacity: 0,
        visibility: "hidden",
        pointerEvents: "none",
        animation: "none"
      } : {})
    }
    return <span key={index} aria-hidden="true" className={cx("dmx-dot", !isActive && "dmx-inactive", isBloomDot && "dmx-bloom-dot", dotClassName, animationState.className)} style={dotStyle} />
  })
  const matrix = <div className={cx("dmx-root", `dmx-dot-shape-${dotShape}`, muted && "dmx-muted", dmxBloomRootActive(bloom, halo) && "dmx-bloom", dmxBloomHaloSpreadClass(halo), !useWrapper && className)} style={dmxVarStyle}>
      <div className="dmx-grid" style={{
      gap
    }}>{dots}</div>
    </div>
  if (useWrapper) {
    return <div role="status" aria-live="polite" aria-label={resolvedAriaLabel} className={className} style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: outerDim,
      height: outerDim,
      minWidth: minSize,
      minHeight: minSize,
      overflow: "hidden",
      ...style
    }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {matrix}
      </div>
  }
  return <div role="status" aria-live="polite" aria-label={resolvedAriaLabel} className={cx("dmx-root", `dmx-dot-shape-${dotShape}`, muted && "dmx-muted", dmxBloomRootActive(bloom, halo) && "dmx-bloom", dmxBloomHaloSpreadClass(halo), className)} style={dmxVarStyle} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="dmx-grid" style={{
      gap
    }}>{dots}</div>
    </div>
}
export function createPathWaveResolver(getPathNorm) {
  return ({
    isActive,
    row,
    col,
    index,
    reducedMotion,
    phase
  }) => {
    if (!isActive) {
      return {
        className: "dmx-inactive"
      }
    }
    const path = getPathNorm({
      row,
      col,
      index
    })
    const style = {
      "--dmx-path": path
    }
    if (reducedMotion || phase === "idle") {
      return {
        style: {
          ...style,
          opacity: 0.12 + path * 0.72
        }
      }
    }
    return {
      className: "dmx-path",
      style
    }
  }
}
export function createPathWaveComponent(displayName, getPathNorm) {
  const resolve = createPathWaveResolver(getPathNorm)
  function PathWaveComponent({
    pattern = "full",
    animated = true,
    hoverAnimated = false,
    speed = 1,
    ...rest
  }) {
    const reducedMotion = usePrefersReducedMotion()
    const {
      phase: matrixPhase,
      onMouseEnter,
      onMouseLeave
    } = useDotMatrixPhases({
      animated: Boolean(animated && !reducedMotion),
      hoverAnimated: Boolean(hoverAnimated && !reducedMotion),
      speed
    })
    return <DotMatrixBase {...rest} speed={speed} pattern={pattern} animated={animated} phase={matrixPhase} reducedMotion={reducedMotion} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} animationResolver={resolve} />
  }
  PathWaveComponent.displayName = displayName
  return PathWaveComponent
}
