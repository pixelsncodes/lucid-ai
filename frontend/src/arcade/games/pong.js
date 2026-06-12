import { OFF, DIM, LIT } from '../constants'

// ── Layout ───────────────────────────────────────────────────────────────────

const COLS         = 24
const ROWS         = 14
const PLAYER_COL   = 1          // player paddle column (drawn here)
const SCRAP_COL    = COLS - 2   // SCRAP paddle column  (drawn here)
const PADDLE_LEN   = 3          // paddle height in dots
const WALL_TOP     = 0
const WALL_BOT     = ROWS - 1

// Collision planes (half-dot in front of the paddle face)
const PLAYER_PLANE = PLAYER_COL + 0.5
const SCRAP_PLANE  = SCRAP_COL  - 0.5

// ── Ball ─────────────────────────────────────────────────────────────────────

const BALL_SPEED_INIT = 11   // dots/sec at serve
const BALL_SPEED_MAX  = 22   // hard cap
const BALL_SPEED_BUMP = 1.07 // factor applied per rally hit

// ── AI (rubber-band) ─────────────────────────────────────────────────────────

const AI_BASE_SPEED  = 6   // dots/sec
const AI_SPEED_MAX   = 10
const AI_SPEED_MIN   = 3
const AI_ERROR_BASE  = 0.9 // reaction noise radius in dots

// ── Timing ───────────────────────────────────────────────────────────────────

const WIN_SCORE         = 5
const COUNTDOWN_STEP_MS = 1000   // one digit per second
const POINT_PAUSE_MS    = 1200   // gap before next countdown

// ── Digit bitmaps (5 wide × 5 tall, '#' = lit) ───────────────────────────────

const DIGITS = {
  3: ['#####', '....#', '#####', '....#', '#####'],
  2: ['#####', '....#', '#####', '#....', '#####'],
  1: ['..#..', '..#..', '..#..', '..#..', '..#..'],
}

// 'P' for pause overlay (3 wide × 5 tall)
const GLYPH_P = ['##.', '#.#', '##.', '#..', '#..']

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPong() {
  let api = null

  // Game state
  let phase        = 'idle'   // idle|countdown|playing|paused|point|win
  let phaseTimer   = 0
  let countdownN   = 3        // 3→2→1 during countdown phase
  let playerScore  = 0
  let scrapScore   = 0

  // Physics objects
  const ball        = { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT }
  const playerPaddle = { y: 0 }  // y = top of paddle (float)
  const scrapPaddle  = { y: 0 }

  // Input state
  let mouseRow     = null    // null = not tracking
  let arrowDelta   = 0       // -1 | 0 | +1
  let aiNoise      = 0       // persistent jitter term

  // ── Helpers ─────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function aiSpeed() {
    const diff = playerScore - scrapScore  // positive = player ahead
    return clamp(AI_BASE_SPEED + diff * 0.5, AI_SPEED_MIN, AI_SPEED_MAX)
  }

  function aiError() {
    const diff = scrapScore - playerScore  // positive = AI ahead → coast
    return AI_ERROR_BASE + diff * 0.25
  }

  function resetPositions() {
    playerPaddle.y = (ROWS - PADDLE_LEN) / 2
    scrapPaddle.y  = (ROWS - PADDLE_LEN) / 2
  }

  function resetBall(serveDir) {
    ball.x = (COLS - 1) / 2
    ball.y = (ROWS - 1) / 2
    // Angle: 25–55° off horizontal
    const angle = (Math.random() * 0.5 + 0.28) * Math.PI
    const dx    = serveDir * Math.cos(angle)
    const dy    = (Math.random() < 0.5 ? 1 : -1) * Math.sin(angle)
    ball.vx = dx * ball.speed
    ball.vy = dy * ball.speed
  }

  function startGame() {
    playerScore   = 0
    scrapScore    = 0
    ball.speed    = BALL_SPEED_INIT
    mouseRow      = null
    arrowDelta    = 0
    aiNoise       = 0
    resetPositions()
    startCountdown(1)   // serve toward SCRAP first
    api.emit('game_start', { game: 'pong' })
  }

  function startCountdown(serveDir) {
    resetBall(serveDir)
    phase       = 'countdown'
    countdownN  = 3
    phaseTimer  = 0
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawScores() {
    for (let i = 0; i < WIN_SCORE; i++) {
      dot(i, 0, i < playerScore ? LIT : DIM)
      dot(COLS - 1 - i, 0, i < scrapScore ? LIT : DIM)
    }
  }

  function drawDivider() {
    for (let r = 1; r < ROWS; r += 2) dot(Math.floor(COLS / 2), r, DIM)
  }

  function drawPaddles() {
    for (let i = 0; i < PADDLE_LEN; i++) {
      const pr = Math.round(playerPaddle.y) + i
      const sr = Math.round(scrapPaddle.y)  + i
      if (pr >= 0 && pr < ROWS) dot(PLAYER_COL, pr, LIT)
      if (sr >= 0 && sr < ROWS) dot(SCRAP_COL,  sr, LIT)
    }
  }

  function drawBall(state = LIT) {
    const bx = Math.round(ball.x)
    const by = Math.round(ball.y)
    if (bx >= 0 && bx < COLS && by >= 0 && by < ROWS) dot(bx, by, state)
  }

  function drawDigit(n) {
    const bm = DIGITS[n]
    if (!bm) return
    // 5×5 bitmap scaled 2×: each '#' → 2×2 block  →  10×10 on the 24×14 grid
    const startCol = Math.floor((COLS - 10) / 2)
    const startRow = Math.floor((ROWS - 10) / 2)
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (bm[r][c] === '#') {
          dot(startCol + c * 2,     startRow + r * 2,     LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2,     LIT)
          dot(startCol + c * 2,     startRow + r * 2 + 1, LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2 + 1, LIT)
        }
      }
    }
  }

  function drawPauseOverlay() {
    const startCol = Math.floor(COLS / 2) - 1
    const startRow = Math.floor(ROWS / 2) - 2
    for (let r = 0; r < GLYPH_P.length; r++) {
      for (let c = 0; c < GLYPH_P[r].length; c++) {
        if (GLYPH_P[r][c] === '#') dot(startCol + c, startRow + r, LIT)
      }
    }
  }

  function drawWin() {
    const playerWon = playerScore >= WIN_SCORE
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (playerWon) {
          // Celebration: checkerboard pattern
          dot(c, r, (r + c) % 2 === 0 ? LIT : OFF)
        } else {
          // SCRAP wins: sparse dim grid
          dot(c, r, (r + c) % 3 === 0 ? DIM : OFF)
        }
      }
    }
    // Show final scores even on win screen
    drawScores()
  }

  function drawFrame(showBall = true, ballState = LIT) {
    api.clearGrid()
    drawScores()
    drawDivider()
    drawPaddles()
    if (showBall) drawBall(ballState)
  }

  // ── Physics ──────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // ── Player paddle ──
    if (mouseRow !== null) {
      // Direct mouse tracking: center paddle on cursor row, clamped
      playerPaddle.y = clamp(mouseRow - PADDLE_LEN / 2, 0, ROWS - PADDLE_LEN)
    } else {
      playerPaddle.y = clamp(
        playerPaddle.y + arrowDelta * 9 * dtS,
        0,
        ROWS - PADDLE_LEN,
      )
    }

    // ── SCRAP AI (rubber-band) ──
    // Drift noise toward zero, then add a small random kick
    aiNoise = aiNoise * 0.92 + (Math.random() - 0.5) * 0.18
    aiNoise  = clamp(aiNoise, -aiError(), aiError())
    const targetY   = ball.y - PADDLE_LEN / 2 + aiNoise
    const aiStep    = aiSpeed() * dtS
    const aiDelta   = targetY - scrapPaddle.y
    scrapPaddle.y   = clamp(
      scrapPaddle.y + Math.sign(aiDelta) * Math.min(Math.abs(aiDelta), aiStep),
      0,
      ROWS - PADDLE_LEN,
    )

    // ── Ball movement ──
    const prevX = ball.x
    ball.x += ball.vx * dtS
    ball.y += ball.vy * dtS

    // Top / bottom wall bounce
    if (ball.y < WALL_TOP) {
      ball.y  = -ball.y
      ball.vy = Math.abs(ball.vy)
    }
    if (ball.y > WALL_BOT) {
      ball.y  = 2 * WALL_BOT - ball.y
      ball.vy = -Math.abs(ball.vy)
    }

    // Player paddle collision (ball moving left, crossing PLAYER_PLANE)
    if (ball.vx < 0 && prevX > PLAYER_PLANE && ball.x <= PLAYER_PLANE) {
      const py = playerPaddle.y
      if (ball.y >= py - 0.5 && ball.y <= py + PADDLE_LEN + 0.5) {
        ball.x  = 2 * PLAYER_PLANE - ball.x
        ball.vx = Math.abs(ball.vx)
        applySpin(py)
        const isEdge =
          Math.abs(ball.y - py) < 0.6 || Math.abs(ball.y - (py + PADDLE_LEN)) < 0.6
        if (isEdge) api.emit('near_miss', { side: 'player' })
      }
    }

    // SCRAP paddle collision (ball moving right, crossing SCRAP_PLANE)
    if (ball.vx > 0 && prevX < SCRAP_PLANE && ball.x >= SCRAP_PLANE) {
      const sy = scrapPaddle.y
      if (ball.y >= sy - 0.5 && ball.y <= sy + PADDLE_LEN + 0.5) {
        ball.x  = 2 * SCRAP_PLANE - ball.x
        ball.vx = -Math.abs(ball.vx)
        applySpin(sy)
        const isEdge =
          Math.abs(ball.y - sy) < 0.6 || Math.abs(ball.y - (sy + PADDLE_LEN)) < 0.6
        if (isEdge) api.emit('near_miss', { side: 'scrap' })
      }
    }

    // Scoring
    if (ball.x < 0) {
      scrapScore++
      api.emit('scrap_scored', { playerScore, scrapScore })
      checkWin(-1)   // next serve toward player
    } else if (ball.x >= COLS) {
      playerScore++
      api.emit('player_scored', { playerScore, scrapScore })
      checkWin(1)    // next serve toward SCRAP
    }
  }

  function applySpin(paddleTop) {
    // English: offset from paddle center adds vertical curve
    const offset = (ball.y - (paddleTop + PADDLE_LEN / 2)) / (PADDLE_LEN / 2)
    ball.vy += offset * 3
    // Renormalise to bumped speed
    const mag   = Math.hypot(ball.vx, ball.vy)
    ball.speed  = Math.min(ball.speed * BALL_SPEED_BUMP, BALL_SPEED_MAX)
    ball.vx     = (ball.vx / mag) * ball.speed
    ball.vy     = (ball.vy / mag) * ball.speed
  }

  function checkWin(nextServeDir) {
    if (playerScore >= WIN_SCORE) {
      phase = 'win'
      api.emit('scrap_lost', { playerScore, scrapScore })
    } else if (scrapScore >= WIN_SCORE) {
      phase = 'win'
      api.emit('scrap_won', { playerScore, scrapScore })
    } else {
      phase      = 'point'
      phaseTimer = 0
      resetBall(nextServeDir)
    }
  }

  // ── Contract ─────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'pong',
      name:     'PONG',
      gridSize: { cols: COLS, rows: ROWS },
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type === 'mouse_y' || event.type === 'touch_y') {
        mouseRow = event.row   // null = stop tracking (let arrowDelta take over)
        return
      }

      if (event.type !== 'keydown' && event.type !== 'keyup') return
      const { key, type } = event

      if (type === 'keydown') {
        if (key === 'Escape') {
          if (phase === 'playing') {
            phase = 'paused'
          } else if (phase === 'paused') {
            phase = 'playing'
          } else if (phase === 'win') {
            ball.speed = BALL_SPEED_INIT
            startGame()
          }
          return
        }
        if (key === 'ArrowUp')   { arrowDelta = -1; mouseRow = null }
        if (key === 'ArrowDown') { arrowDelta =  1; mouseRow = null }
        if (phase === 'win' && (key === ' ' || key === 'Enter')) {
          ball.speed = BALL_SPEED_INIT
          startGame()
        }
      }

      if (type === 'keyup') {
        if (key === 'ArrowUp' && arrowDelta === -1) arrowDelta = 0
        if (key === 'ArrowDown' && arrowDelta === 1) arrowDelta = 0
      }
    },

    tick(dt) {
      if (phase === 'countdown') {
        phaseTimer += dt
        if (phaseTimer >= COUNTDOWN_STEP_MS) {
          phaseTimer -= COUNTDOWN_STEP_MS
          countdownN--
          if (countdownN <= 0) phase = 'playing'
        }
        // Draw paddles + scores behind the countdown digit so player can prep
        drawFrame(false)
        if (phase === 'countdown') drawDigit(countdownN)
      } else if (phase === 'playing') {
        tickPlaying(dt)
        drawFrame(true, LIT)
      } else if (phase === 'paused') {
        drawFrame(true, DIM)
        drawPauseOverlay()
      } else if (phase === 'point') {
        phaseTimer += dt
        // Show game frozen; ball is dim (about to be served)
        drawFrame(true, DIM)
        if (phaseTimer >= POINT_PAUSE_MS) startCountdown(ball.vx > 0 ? 1 : -1)
      } else if (phase === 'win') {
        api.clearGrid()
        drawWin()
      }
    },

    destroy() {
      api = null
    },
  }
}
