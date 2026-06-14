// ── Canvas Tetris ─────────────────────────────────────────────────────────────
// Classic white-on-black portrait layout. Renders via render(ctx, {w, h});
// tick() is pure logic. Board state uses OFF/DIM from constants so that test
// helpers (_getBoard / _setBoard) work identically to the matrix version.

import { OFF, DIM } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS = 10
const ROWS = 20

const LOGICAL_W = 240   // portrait — 10 cols × 24 px
const LOGICAL_H = 480   // portrait — 20 rows × 24 px

// ── Pieces ────────────────────────────────────────────────────────────────────

const PIECES = [
  // 0 = I (size 4)
  [
    [[0,1],[1,1],[2,1],[3,1]],
    [[2,0],[2,1],[2,2],[2,3]],
    [[0,2],[1,2],[2,2],[3,2]],
    [[1,0],[1,1],[1,2],[1,3]],
  ],
  // 1 = O (size 2, single rotation)
  [[[0,0],[1,0],[0,1],[1,1]]],
  // 2 = T (size 3)
  [
    [[1,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[2,1],[1,2]],
    [[0,1],[1,1],[2,1],[1,2]],
    [[1,0],[0,1],[1,1],[1,2]],
  ],
  // 3 = S (size 3)
  [
    [[1,0],[2,0],[0,1],[1,1]],
    [[1,0],[1,1],[2,1],[2,2]],
  ],
  // 4 = Z (size 3)
  [
    [[0,0],[1,0],[1,1],[2,1]],
    [[2,0],[1,1],[2,1],[1,2]],
  ],
  // 5 = J (size 3)
  [
    [[0,0],[0,1],[1,1],[2,1]],
    [[1,0],[2,0],[1,1],[1,2]],
    [[0,1],[1,1],[2,1],[2,2]],
    [[1,0],[1,1],[0,2],[1,2]],
  ],
  // 6 = L (size 3)
  [
    [[2,0],[0,1],[1,1],[2,1]],
    [[1,0],[1,1],[1,2],[2,2]],
    [[0,1],[1,1],[2,1],[0,2]],
    [[0,0],[1,0],[1,1],[1,2]],
  ],
]

const PIECE_SIZES = [4, 2, 3, 3, 3, 3, 3]

// ── Scoring ───────────────────────────────────────────────────────────────────

const LINE_SCORES  = [0, 40, 100, 300, 1200]
const LEVEL_LINES  = 10

// ── Timing ────────────────────────────────────────────────────────────────────

const FALL_TICKS_INIT   = 45
const FALL_TICKS_MIN    = 6
const SOFT_DROP_TICKS   = 2
const LOCK_DELAY        = 30
const COUNTDOWN_STEP_MS = 800

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTetris() {
  let api = null

  let board = []

  let piece    = 0
  let rotation = 0
  let px       = 3
  let py       = 0

  let nextPiece = 0

  let fallTimer  = 0
  let lockTimer  = 0
  let touching   = false

  let totalLines = 0
  let level      = 1
  let score      = 0
  let fallTicks  = FALL_TICKS_INIT

  let softDrop   = false

  let phase      = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  // ── Helpers ────────────────────────────────────────────────────────────────

  function cells(p, r) {
    return PIECES[p][r % PIECES[p].length]
  }

  function absCells(p, r, bx, by) {
    return cells(p, r).map(([dc, dr]) => [bx + dc, by + dr])
  }

  function collides(p, r, bx, by) {
    for (const [c, row] of absCells(p, r, bx, by)) {
      if (c < 0 || c >= COLS || row >= ROWS) return true
      if (row >= 0 && board[row][c] !== OFF) return true
    }
    return false
  }

  function initBoard() {
    board = Array.from({ length: ROWS }, () => new Array(COLS).fill(OFF))
  }

  function spawnPiece() {
    piece    = nextPiece
    rotation = 0
    const size = PIECE_SIZES[piece]
    px = Math.floor((COLS - size) / 2)
    py = 0
    touching   = false
    fallTimer  = 0
    lockTimer  = 0

    if (collides(piece, rotation, px, py)) {
      phase = 'gameover'
      api.emit('scrap_won', { score, totalLines })
    } else {
      nextPiece = Math.floor(Math.random() * PIECES.length)
    }
  }

  function startGame() {
    initBoard()
    totalLines = 0
    level      = 1
    score      = 0
    fallTicks  = FALL_TICKS_INIT
    softDrop   = false
    nextPiece  = Math.floor(Math.random() * PIECES.length)
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
    api.emit('game_start', { game: 'tetris' })
  }

  function lockPiece() {
    for (const [c, r] of absCells(piece, rotation, px, py)) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = DIM
    }
    clearLines()
    spawnPiece()
  }

  function clearLines() {
    let cleared = 0
    for (let r = ROWS - 1; r >= 0; r--) {
      if (board[r].every(v => v !== OFF)) {
        board.splice(r, 1)
        board.unshift(new Array(COLS).fill(OFF))
        cleared++
        r++
      }
    }
    if (cleared > 0) {
      totalLines += cleared
      score      += (LINE_SCORES[cleared] ?? 1200) * level
      level       = Math.floor(totalLines / LEVEL_LINES) + 1
      fallTicks   = Math.max(FALL_TICKS_MIN, FALL_TICKS_INIT - (level - 1) * 5)
      api.emit('player_scored', { lines: cleared, totalLines, level, score })
    }
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function tickPlaying() {
    const interval = softDrop ? SOFT_DROP_TICKS : fallTicks

    fallTimer++
    if (fallTimer >= interval) {
      fallTimer = 0

      if (!collides(piece, rotation, px, py + 1)) {
        py++
        touching  = false
        lockTimer = 0
      } else {
        touching = true
      }
    }

    if (touching) {
      lockTimer++
      if (lockTimer >= LOCK_DELAY) lockPiece()
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    const cellW = w / COLS
    const cellH = h / ROWS

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Well border (subtle outline)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1)

    // Locked board cells
    ctx.fillStyle = '#fff'
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] !== OFF) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)'
          ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2)
        }
      }
    }

    // Active piece (bright white)
    if (phase === 'playing' || phase === 'paused') {
      const alpha = phase === 'paused' ? 0.35 : 1
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      for (const [c, r] of absCells(piece, rotation, px, py)) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2)
        }
      }
    }

    // HUD — score / level at bottom overlay
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '11px monospace'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    ctx.fillText(`LV ${level}`, 4, h - 2)
    ctx.textAlign = 'right'
    ctx.fillText(`${score}`, w - 4, h - 2)

    // Countdown overlay
    if (phase === 'countdown') {
      ctx.fillStyle = '#fff'
      ctx.font = '72px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(countdownN), w / 2, h / 2)
    }

    // Pause overlay
    if (phase === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '28px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('PAUSED', w / 2, h / 2)
    }

    // Game-over screen
    if (phase === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '28px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GAME OVER', w / 2, h / 2 - 22)
      ctx.font = '13px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to restart', w / 2, h / 2 + 16)
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'tetris',
      name:          'TETRIS',
      renderer:      'canvas',
      logicalWidth:  LOGICAL_W,
      logicalHeight: LOGICAL_H,
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type === 'mouse_y' || event.type === 'touch_y') return
      if (event.type !== 'keydown' && event.type !== 'keyup') return
      const { key, type } = event

      if (type === 'keydown') {
        if (phase !== 'playing') {
          if (key === ' ' || key === 'Enter') {
            if (phase === 'gameover') startGame()
          }
          if (key === 'Escape' && phase === 'paused') phase = 'playing'
          return
        }

        if (key === 'Escape') { phase = 'paused'; return }

        if (key === 'ArrowLeft'  && !collides(piece, rotation, px - 1, py)) { px--; lockTimer = 0 }
        if (key === 'ArrowRight' && !collides(piece, rotation, px + 1, py)) { px++; lockTimer = 0 }
        if (key === 'ArrowDown') softDrop = true
        if (key === 'ArrowUp') {
          const newRot = (rotation + 1) % PIECES[piece].length
          if (!collides(piece, newRot, px, py))       { rotation = newRot; lockTimer = 0 }
          else if (!collides(piece, newRot, px - 1, py)) { px--; rotation = newRot; lockTimer = 0 }
          else if (!collides(piece, newRot, px + 1, py)) { px++; rotation = newRot; lockTimer = 0 }
        }
        if (key === ' ') {
          while (!collides(piece, rotation, px, py + 1)) py++
          lockPiece()
        }
      }

      if (type === 'keyup') {
        if (key === 'ArrowDown') softDrop = false
      }
    },

    tick(dt) {
      if (phase === 'countdown') {
        phaseTimer += dt
        while (phaseTimer >= COUNTDOWN_STEP_MS) {
          phaseTimer -= COUNTDOWN_STEP_MS
          countdownN--
          if (countdownN <= 0) { phase = 'playing'; spawnPiece(); break }
        }
        return
      }

      if (phase === 'playing') {
        tickPlaying()
        return
      }
    },

    render,

    destroy() { api = null },

    // ── Test-only helpers ──────────────────────────────────────────────────
    _getPhase()          { return phase },
    _getScore()          { return score },
    _getTotalLines()     { return totalLines },
    _getLevel()          { return level },
    _getPiece()          { return { piece, rotation, px, py } },
    _getBoard()          { return board.map(row => [...row]) },
    _forcePhase(p)       { phase = p },
    _forcePlay()         { phase = 'playing'; spawnPiece() },
    _setBoard(b)         { board = b.map(row => [...row]) },
    _setPiece(p, r, x, y){ piece = p; rotation = r; px = x; py = y; touching = false; fallTimer = 0; lockTimer = 0 },
    _setNextPiece(p)     { nextPiece = p },
  }
}
