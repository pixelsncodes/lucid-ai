// ── Canvas Snake ──────────────────────────────────────────────────────────────
// Classic white-on-black. Renders via render(ctx, {w, h}); tick() is logic only.

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS     = 24
const ROWS     = 14
const PLAY_TOP = 1        // row 0 = score pip strip
const PLAY_BOT = ROWS - 1

const LOGICAL_W = 480
const LOGICAL_H = 280

// ── Timing ────────────────────────────────────────────────────────────────────

const TICK_INTERVAL_INIT = 8    // game-ticks per snake step (60fps → ~7.5 steps/sec)
const TICK_INTERVAL_MIN  = 4    // max speed (15 steps/sec)
const COUNTDOWN_STEP_MS  = 800

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

  function randomFood() {
    for (let attempt = 0; attempt < 400; attempt++) {
      const x = Math.floor(Math.random() * COLS)
      const y = PLAY_TOP + Math.floor(Math.random() * (PLAY_BOT - PLAY_TOP + 1))
      if (!snake.some(s => s.x === x && s.y === y)) return { x, y }
    }
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

  // ── Physics ────────────────────────────────────────────────────────────────

  function step() {
    // Apply queued direction (reject 180° reversal)
    if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = { ...nextDir }

    const head    = snake[0]
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

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    const cellW = w / COLS
    const cellH = h / ROWS

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Score pip strip (row 0) — one pip per point earned
    const lit = Math.min(score, COLS)
    for (let i = 0; i < COLS; i++) {
      ctx.fillStyle = i < lit ? '#fff' : 'rgba(255,255,255,0.1)'
      ctx.fillRect(i * cellW + 1, 1, cellW - 2, cellH - 2)
    }

    // Snake segments
    for (let i = 0; i < snake.length; i++) {
      const s = snake[i]
      const alive = phase !== 'dead'
      ctx.fillStyle = alive
        ? (i === 0 ? '#fff' : 'rgba(255,255,255,0.7)')
        : 'rgba(255,255,255,0.22)'
      ctx.fillRect(s.x * cellW + 1, s.y * cellH + 1, cellW - 2, cellH - 2)
    }

    // Food (blinking — same 15-tick cadence as before)
    if (phase !== 'dead' && Math.floor(foodBlink / 15) % 2 === 0) {
      const m = cellW * 0.2
      ctx.fillStyle = '#fff'
      ctx.fillRect(food.x * cellW + m, food.y * cellH + m, cellW - m * 2, cellH - m * 2)
    }

    // Countdown overlay
    if (phase === 'countdown') {
      ctx.fillStyle = '#fff'
      ctx.font = '72px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(countdownN), w / 2, h / 2)
    }

    // Game-over screen
    if (phase === 'dead') {
      ctx.fillStyle = '#fff'
      ctx.font = '40px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GAME OVER', w / 2, h / 2 - 24)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to restart', w / 2, h / 2 + 20)
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'snake',
      name:          'SNAKE',
      renderer:      'canvas',
      logicalWidth:  LOGICAL_W,
      logicalHeight: LOGICAL_H,
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
        return
      }

      if (phase === 'playing') {
        tickAccum++
        if (tickAccum >= tickInterval) { tickAccum = 0; step() }
        return
      }
    },

    render,

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
