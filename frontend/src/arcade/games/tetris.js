import { OFF, DIM, LIT } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS = 10
const ROWS = 20

// ── Pieces ────────────────────────────────────────────────────────────────────
// Each piece: array of rotation states; each state: array of [col, row] offsets
// from bounding-box top-left. Bounding box size determines spawn centering.

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

const LINE_SCORES  = [0, 40, 100, 300, 1200]  // Tetris classic scoring
const LEVEL_LINES  = 10                         // lines per level

// ── Timing ────────────────────────────────────────────────────────────────────

const FALL_TICKS_INIT = 45   // ticks per gravity drop at level 1
const FALL_TICKS_MIN  = 6    // fastest (level ~7+)
const SOFT_DROP_TICKS = 2    // ticks per drop when ArrowDown held
const LOCK_DELAY      = 30   // ticks before piece locks after touching ground
const COUNTDOWN_STEP_MS = 800

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTetris() {
  let api = null

  // Board: board[row][col] = LIT|DIM|OFF
  let board = []

  // Active piece
  let piece    = 0    // index into PIECES
  let rotation = 0
  let px       = 3    // bounding-box col (top-left)
  let py       = 0    // bounding-box row (top-left)

  let nextPiece = 0

  // Timing
  let fallTimer  = 0    // ticks since last gravity step
  let lockTimer  = 0    // ticks the piece has been touching the ground
  let touching   = false

  // Progression
  let totalLines = 0
  let level      = 1
  let score      = 0
  let fallTicks  = FALL_TICKS_INIT

  // Input flags
  let softDrop   = false

  // Phase
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
      // Can't place new piece → game over
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
        r++  // re-check same row index (now contains what was above)
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

  // ── Drawing ────────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawBoard() {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        dot(c, r, board[r][c])
  }

  function drawPiece(state = LIT) {
    for (const [c, r] of absCells(piece, rotation, px, py)) {
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS) dot(c, r, state)
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

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'tetris',
      name:     'TETRIS',
      gridSize: { cols: COLS, rows: ROWS },
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
          // Hard drop
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
        api.clearGrid()
        drawBoard()
        return
      }

      if (phase === 'playing') {
        tickPlaying()
        api.clearGrid()
        drawBoard()
        if (phase === 'playing') drawPiece()
        return
      }

      if (phase === 'paused') {
        api.clearGrid()
        drawBoard()
        drawPiece(DIM)
        return
      }

      if (phase === 'gameover') {
        api.clearGrid()
        drawBoard()
        return
      }
    },

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
