// ── Dot Matrix engine data ─────────────────────────────────
// 5×5 grid geometry, bitmaps, and animation delay math.
// Ported from dot-matrix-builder.html.

export const N = 5
const C = 2
export const ALL = Array.from({ length: 25 }, (_, i) => i)

export function coord(i) {
  return { row: Math.floor(i / N), col: i % N }
}

function dist(i) {
  const { row, col } = coord(i)
  return Math.hypot(row - C, col - C)
}

const MAXD = Math.hypot(C, C)

// ── Patterns ────────────────────────────────────────────────
export const PATTERNS = {
  diamond: ALL.filter((i) => {
    const { row, col } = coord(i)
    return Math.abs(row - C) + Math.abs(col - C) <= 2
  }),
  full: ALL,
}

// ── Face bitmaps — . off, x face, e eye, m mouth ───────────
export const FACES = {
  ':)': '.....|.e.e.|.....|m...m|.mmm.',
  ':(': '.....|.e.e.|.....|.mmm.|m...m',
  ';)': '.....|ee.e.|.....|m...m|.mmm.',
  ":'(": '.....|.e.e.|x....|.mmm.|m...m',
  ':D': '.e.e.|.....|mmmmm|m...m|.mmm.',
  ':P': '.....|.e.e.|.....|mmmmm|..xx.',
  ':/': '.....|.e.e.|.....|...mm|mmm..',
  ':|': '.....|.e.e.|.....|mmmmm|.....',
  '^-^': '.e.e.|e.e.e|.....|m...m|.mmm.',
  '>:(': 'x...x|.e.e.|.....|.mmm.|m...m',
  ':O': '.e.e.|.....|.mmm.|.m.m.|.mmm.',
  ':3': '.....|.e.e.|.....|m.m.m|.m.m.',
  '8)': '.....|eeeee|ee.ee|.....|.mmm.',
  '-_-': '.....|ee.ee|.....|.mmm.|.....',
  'O_O': 'ee.ee|ee.ee|.....|.mmm.|.....',
  'T_T': 'ee.ee|.e.e.|.e.e.|.....|.mmm.',
  ':*': '.....|.e.e.|.....|..mm.|..m..',
  '<3': '.x.x.|xxxxx|xxxxx|.xxx.|..x..',
}

// ── Glyph bitmaps — 5×5 pixel font ─────────────────────────
export const GLYPHS = {
  H: 'x...x|x...x|xxxxx|x...x|x...x',
  I: 'xxxxx|..x..|..x..|..x..|xxxxx',
  Z: 'xxxxx|...x.|..x..|.x...|xxxxx',
  '?': '.xxx.|x...x|..xx.|.....|..x..',
  '!': '..x..|..x..|..x..|.....|..x..',
}

// ── Bitmap → dot data ───────────────────────────────────────
export function faceDots(face) {
  const source = face && face.includes('|') ? face : FACES[face] || FACES[':)']
  const bm = source.replace(/\|/g, '')
  return [...bm].map((ch) => ({ active: ch !== '.', role: ch }))
}

// laugh cycle — :) bouncing up into a raised :D (two frames)
export const LAUGH_FRAMES = [
  '.....|.e.e.|.....|m...m|.mmm.',
  '.e.e.|mmmmm|m...m|.mmm.|.....',
]

export function glyphDots(glyph) {
  const bm = (GLYPHS[glyph] || GLYPHS['?']).replace(/\|/g, '')
  return [...bm].map((ch) => ({ active: ch !== '.', role: 'x' }))
}

export function patternDots(pattern) {
  const set = new Set(PATTERNS[pattern] || PATTERNS.diamond)
  return ALL.map((i) => ({ active: set.has(i), role: 'x' }))
}

// ── Animation delays ────────────────────────────────────────
export function rippleDelay(i, cycleMs, stagger = 0.23) {
  return Math.round((dist(i) / MAXD) * stagger * cycleMs * 2.83)
}

// ── Speak mode — middle 3 lip columns become a 2-level EQ ──
const SPEAK_COLS = [1, 2, 3]
export const SPEAK_DUR = [560, 710, 470]
export const SPEAK_DELAY = [-130, -310, -60]

export function speakZone(i) {
  const { row, col } = coord(i)
  if (!SPEAK_COLS.includes(col)) return null
  if (row === 3) return { kind: 'vu', ci: SPEAK_COLS.indexOf(col) }
  if (row === 4) return { kind: 'vl', ci: SPEAK_COLS.indexOf(col) }
  return null
}

// ── Ticker — row gradient strips (5 blank + 5 bitmap cols) ──
function hexToRgba(hex, a) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export function rowGradient(dots, r, color, opPeak, opGrid) {
  const dim = hexToRgba(color, opGrid)
  const on = hexToRgba(color, opPeak)
  const cells = []
  for (let k = 0; k < 10; k++) {
    const isOn = k >= 5 && dots[r * 5 + (k - 5)].active
    cells.push(`${isOn ? on : dim} ${k * 10}% ${(k + 1) * 10}%`)
  }
  return `linear-gradient(to right, ${cells.join(', ')})`
}

// ── Reply emotion parsing ───────────────────────────────────
// An assistant reply may end with one emoticon from FACES;
// strip it from the text and surface it on the matrix.
const FACE_KEYS = Object.keys(FACES).sort((a, b) => b.length - a.length)
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const TRAILING_FACE = new RegExp(
  `(?:^|\\s)(${FACE_KEYS.map(escapeRegExp).join('|')})\\s*$`,
)

export function extractReplyFace(text) {
  const match = String(text || '').match(TRAILING_FACE)
  if (!match) return { text: String(text || ''), face: null }
  const cleaned = text.slice(0, match.index).trimEnd()
  // Never strip the entire reply — a bare emoticon stays as text.
  if (!cleaned) return { text: String(text || ''), face: null }
  return { text: cleaned, face: match[1] }
}
