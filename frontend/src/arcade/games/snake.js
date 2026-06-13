import { OFF, DIM, LIT } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS = 24
const ROWS = 14
const PLAY_TOP = 1        // row 0 = score HUD
const PLAY_BOT = ROWS - 1

// ── Timing ────────────────────────────────────────────────────────────────────

const TICK_INTERVAL_INIT = 8   // game-ticks per snake step (60fps → ~7.5 steps/sec)
const TICK_INTERVAL_MIN  = 4   // max speed (15 steps/sec)
const COUNTDOWN_STEP_MS  = 800

// ── Digit bitmaps (5×5, same format as pong.js) ───────────────────────────────

const DIGITS = {
  3: ['#####', '....#', '#####', '....#', '#####'],
  2: ['#####', '....#', '#####', '#....', '#####'],
  1: ['..#..', '..#..', '..#..', '..#..', '..#..'],
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createSnake() {
  let api = null

  let snake        = []         // [{x,y}], head first
  let food         = { x: 0, y: 0 }
  let dir          = { x: 1, y: 0 }
  let nextDir      = { x: 1, y: 0 }
  let tickAccum    = 0
  let tickInterval = TICK_INTERVAL_INIT
  let score        = 0
  let phase        = 'idle'     // idle|countdown|playing|dead
  let phaseTimer   = 0
  let countdownN   = 3
  let foodBlink    = 0

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function randomFood() {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = Math.floor(Math.random() * COLS)
      const y = PLAY_TOP + Math.floor(Math.random() * (PLAY_BOT - PLAY_TOP + 1))
      if (!snake.some(s => s.x === x && s.y === y)) return { x, y }
    }
    // Fallback: first empty cell (shouldn't be reached in practice)
    for (let y = PLAY_TOP; y <= PLAY_BOT; y++)
      for (let x = 0; x < COLS; x++)
        if (!snake.some(s => s.x === x && s.y === y)) return { x, y }
    return { x: 0, y: PLAY_TOP }
  }

  function initSnake() {
    const cx = Math.floor(COLS / 2)
    const cy = Math.floor((PLAY_TOP + PLAY_BOT) / 2)
    snake        = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }]
    dir          = { x: 1, y: 0 }
    nextDir      = { x: 1, y: 0 }
    tickAccum    = 0
    tickInterval = TICK_INTERVAL_INIT
    score        = 0
    food         = randomFood()
    foodBlink    = 0
  }

  function startGame() {
    initSnake()
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
    api.emit('game_start', { game: 'snake' })
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawHUD() {
    const lit = Math.min(score, COLS)
    for (let i = 0; i < COLS; i++) dot(i, 0, i < lit ? LIT : DIM)
  }

  function drawSnake() {
    for (let i = 0; i < snake.length; i++) {
      const s = snake[i]
      if (s.y < PLAY_TOP) continue
      dot(s.x, s.y, i === 0 ? LIT : DIM)
    }
  }

  function drawFood() {
    const show = Math.floor(foodBlink / 15) % 2 === 0
    if (show) dot(food.x, food.y, LIT)
  }

  function drawDigit(n) {
    const bm = DIGITS[n]
    if (!bm) return
    const startCol = Math.floor((COLS - 10) / 2)
    const startRow = Math.floor(PLAY_TOP + (PLAY_BOT - PLAY_TOP + 1 - 10) / 2)
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        if (bm[r][c] === '#') {
          dot(startCol + c * 2,     startRow + r * 2,     LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2,     LIT)
          dot(startCol + c * 2,     startRow + r * 2 + 1, LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2 + 1, LIT)
        }
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function step() {
    // Apply queued direction (reject 180° reversal)
    if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = { ...nextDir }

    const head   = snake[0]
    const newHead = { x: head.x + dir.x, y: head.y + dir.y }

    // Wall collision
    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < PLAY_TOP || newHead.y > PLAY_BOT) {
      die(); return
    }
    // Self collision
    if (snake.some(s => s.x === newHead.x && s.y === newHead.y)) { die(); return }

    snake.unshift(newHead)

    if (newHead.x === food.x && newHead.y === food.y) {
      score++
      tickInterval = Math.max(TICK_INTERVAL_MIN, TICK_INTERVAL_INIT - Math.floor(score / 3))
      api.emit('player_scored', { score, length: snake.length })
      food = randomFood()
    } else {
      snake.pop()
    }
  }

  function die() {
    phase = 'dead'
    api.emit('scrap_won', { score, length: snake.length })
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'snake',
      name:     'SNAKE',
      gridSize: { cols: COLS, rows: ROWS },
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type !== 'keydown') return
      const { key } = event

      if (key === ' ' || key === 'Enter') {
        if (phase === 'idle' || phase === 'dead') startGame()
        return
      }
      if (key === 'Escape') {
        if (phase === 'playing') { api.emit('game_quit', { score }); die() }
        return
      }

      const dirs = {
        ArrowUp:    { x: 0,  y: -1 },
        ArrowDown:  { x: 0,  y:  1 },
        ArrowLeft:  { x: -1, y:  0 },
        ArrowRight: { x: 1,  y:  0 },
      }
      if (dirs[key]) nextDir = dirs[key]
    },

    tick(dt) {
      foodBlink = (foodBlink + 1) % 60

      if (phase === 'countdown') {
        phaseTimer += dt
        while (phaseTimer >= COUNTDOWN_STEP_MS) {
          phaseTimer -= COUNTDOWN_STEP_MS
          countdownN--
          if (countdownN <= 0) { phase = 'playing'; break }
        }
        api.clearGrid()
        drawHUD()
        drawSnake()
        drawFood()
        if (phase === 'countdown') drawDigit(countdownN)
        return
      }

      if (phase === 'playing') {
        tickAccum++
        if (tickAccum >= tickInterval) { tickAccum = 0; step() }
        if (phase !== 'dead') {
          api.clearGrid()
          drawHUD()
          drawSnake()
          drawFood()
        }
        return
      }

      if (phase === 'dead') {
        api.clearGrid()
        drawHUD()
        for (const s of snake) dot(s.x, s.y, DIM)
        return
      }
    },

    destroy() { api = null },

    // ── Test-only helpers (not part of the game contract) ──────────────────
    _getPhase()             { return phase },
    _getScore()             { return score },
    _setFood(x, y)          { food = { x, y } },
    _getSnakeHead()         { return snake[0] ? { ...snake[0] } : null },
    _getSnakeLength()       { return snake.length },
    _setSnake(cells, d)     { snake = cells.map(c => ({ ...c })); dir = { ...d }; nextDir = { ...d } },
  }
}
