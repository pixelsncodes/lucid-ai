import { OFF, DIM, LIT } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS         = 24
const ROWS         = 16
const BRICK_ROW_1  = 1          // first brick row
const BRICK_ROW_N  = 5          // last brick row  (5 rows × 22 bricks each = 110)
const BRICK_COL_1  = 1
const BRICK_COL_N  = COLS - 2   // cols 1..22
const PADDLE_ROW   = ROWS - 1   // row 15
const PADDLE_WIDTH = 4

// ── Ball ─────────────────────────────────────────────────────────────────────

const BALL_SPEED_INIT = 9    // dots/sec
const BALL_SPEED_MAX  = 16
const BALL_SPEED_BUMP = 1.06 // per paddle hit
const SERVE_ANGLE_MIN = 0.3  // radians from vertical

// ── Timing ───────────────────────────────────────────────────────────────────

const LIVES_INIT         = 3
const WIN_SCORE          = (BRICK_ROW_N - BRICK_ROW_1 + 1) * (BRICK_COL_N - BRICK_COL_1 + 1)
const COUNTDOWN_STEP_MS  = 800
const POINT_PAUSE_MS     = 1000  // pause after ball lost before next serve

const DIGITS = {
  3: ['#####', '....#', '#####', '....#', '#####'],
  2: ['#####', '....#', '#####', '#....', '#####'],
  1: ['..#..', '..#..', '..#..', '..#..', '..#..'],
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createBreakout() {
  let api = null

  // Grid of bricks: true = alive, false = cleared
  let bricks = []
  let bricksRemaining = 0

  const ball    = { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT }
  const paddle  = { x: 0 }   // paddle left-edge column (float)

  let lives      = LIVES_INIT
  let score      = 0
  let phase      = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  let arrowDelta  = 0  // -1|0|1 from keyboard
  let mouseCol    = null  // null = keyboard only; set from mouse_y mapped to x

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function initBricks() {
    bricks = []
    for (let r = 0; r < ROWS; r++) {
      bricks[r] = []
      for (let c = 0; c < COLS; c++) bricks[r][c] = false
    }
    for (let r = BRICK_ROW_1; r <= BRICK_ROW_N; r++)
      for (let c = BRICK_COL_1; c <= BRICK_COL_N; c++)
        bricks[r][c] = true
    bricksRemaining = (BRICK_ROW_N - BRICK_ROW_1 + 1) * (BRICK_COL_N - BRICK_COL_1 + 1)
  }

  function serveBall() {
    paddle.x = (COLS - PADDLE_WIDTH) / 2
    ball.x   = COLS / 2
    ball.y   = PADDLE_ROW - 2
    const angle  = (Math.random() * Math.PI * 0.4) + SERVE_ANGLE_MIN
    const sign   = Math.random() < 0.5 ? 1 : -1
    ball.vx  = sign * Math.sin(angle) * ball.speed
    ball.vy  = -Math.abs(Math.cos(angle)) * ball.speed
  }

  function startGame() {
    initBricks()
    lives      = LIVES_INIT
    score      = 0
    ball.speed = BALL_SPEED_INIT
    arrowDelta = 0
    mouseCol   = null
    startCountdown()
    api.emit('game_start', { game: 'breakout' })
  }

  function startCountdown() {
    serveBall()
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawHUD() {
    // Row 0: left = life pips, right = score pips
    for (let i = 0; i < LIVES_INIT; i++)
      dot(i, 0, i < lives ? LIT : DIM)
    const scoreShown = Math.min(score, COLS - LIVES_INIT - 1)
    for (let i = LIVES_INIT + 1; i < COLS; i++) {
      const idx = i - LIVES_INIT - 1
      dot(i, 0, idx < scoreShown ? LIT : DIM)
    }
  }

  function drawBricks() {
    for (let r = BRICK_ROW_1; r <= BRICK_ROW_N; r++)
      for (let c = BRICK_COL_1; c <= BRICK_COL_N; c++)
        dot(c, r, bricks[r][c] ? DIM : OFF)
  }

  function drawPaddle() {
    const px = Math.round(paddle.x)
    for (let i = 0; i < PADDLE_WIDTH; i++) {
      const c = px + i
      if (c >= 0 && c < COLS) dot(c, PADDLE_ROW, LIT)
    }
  }

  function drawBall(state = LIT) {
    const bx = Math.round(ball.x), by = Math.round(ball.y)
    if (bx >= 0 && bx < COLS && by >= 0 && by < ROWS) dot(bx, by, state)
  }

  function drawDigit(n) {
    const bm = DIGITS[n]
    if (!bm) return
    const startCol = Math.floor((COLS - 10) / 2)
    const startRow = Math.floor((ROWS - 10) / 2)
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++)
        if (bm[r][c] === '#') {
          dot(startCol + c * 2,     startRow + r * 2,     LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2,     LIT)
          dot(startCol + c * 2,     startRow + r * 2 + 1, LIT)
          dot(startCol + c * 2 + 1, startRow + r * 2 + 1, LIT)
        }
  }

  function drawFrame(showBall = true, ballState = LIT) {
    api.clearGrid()
    drawHUD()
    drawBricks()
    drawPaddle()
    if (showBall) drawBall(ballState)
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // Paddle movement
    if (mouseCol !== null) {
      paddle.x = clamp(mouseCol, 0, COLS - PADDLE_WIDTH)
    } else {
      paddle.x = clamp(paddle.x + arrowDelta * 14 * dtS, 0, COLS - PADDLE_WIDTH)
    }

    // Ball movement
    const prevX = ball.x, prevY = ball.y
    ball.x += ball.vx * dtS
    ball.y += ball.vy * dtS

    // Left/right walls
    if (ball.x < 0)       { ball.x = -ball.x;              ball.vx =  Math.abs(ball.vx) }
    if (ball.x >= COLS)   { ball.x = 2*(COLS-1) - ball.x;  ball.vx = -Math.abs(ball.vx) }

    // Top wall
    if (ball.y < BRICK_ROW_1 - 0.5) {
      ball.y  = 2*(BRICK_ROW_1 - 0.5) - ball.y
      ball.vy = Math.abs(ball.vy)
    }

    // Brick collision: check cell the ball is in
    const bx = Math.round(ball.x), by = Math.round(ball.y)
    if (by >= BRICK_ROW_1 && by <= BRICK_ROW_N && bx >= BRICK_COL_1 && bx <= BRICK_COL_N && bricks[by]?.[bx]) {
      bricks[by][bx] = false
      bricksRemaining--
      score++
      api.emit('player_scored', { score, bricksRemaining })
      // Determine bounce direction from approach
      const byPrev = Math.round(prevY)
      if (byPrev !== by) ball.vy = -ball.vy
      else ball.vx = -ball.vx
      if (bricksRemaining === 0) {
        phase = 'win'
        api.emit('scrap_lost', { score })
        return
      }
    }

    // Paddle collision
    const paddleLeft  = paddle.x
    const paddleRight = paddle.x + PADDLE_WIDTH - 1
    if (ball.vy > 0 && prevY < PADDLE_ROW - 0.5 && ball.y >= PADDLE_ROW - 0.5) {
      if (ball.x >= paddleLeft - 0.5 && ball.x <= paddleRight + 0.5) {
        ball.y  = 2*(PADDLE_ROW - 0.5) - ball.y
        ball.vy = -Math.abs(ball.vy)
        // Spin: offset from paddle center affects horizontal angle
        const offset  = (ball.x - (paddleLeft + (PADDLE_WIDTH - 1) / 2)) / (PADDLE_WIDTH / 2)
        ball.vx      += offset * 2
        const mag     = Math.hypot(ball.vx, ball.vy)
        ball.speed    = Math.min(ball.speed * BALL_SPEED_BUMP, BALL_SPEED_MAX)
        ball.vx       = (ball.vx / mag) * ball.speed
        ball.vy       = (ball.vy / mag) * ball.speed
        // near_miss: ball hit near paddle edge
        const edgeDist = Math.min(Math.abs(ball.x - paddleLeft), Math.abs(ball.x - paddleRight))
        if (edgeDist < 0.8) api.emit('near_miss', { side: offset < 0 ? 'left' : 'right' })
      } else {
        // Ball below paddle plane but missed paddle → lost
        loseLife()
      }
    }

    // Ball fell below paddle (missed the collision plane check above due to fast ball)
    if (ball.y > PADDLE_ROW + 1) loseLife()
  }

  function loseLife() {
    lives--
    if (lives <= 0) {
      phase = 'gameover'
      api.emit('scrap_won', { score, lives: 0 })
    } else {
      phase      = 'point'
      phaseTimer = 0
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'breakout',
      name:     'BREAKOUT',
      gridSize: { cols: COLS, rows: ROWS },
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type === 'mouse_y' || event.type === 'touch_y') {
        // Map mouse Y fraction to paddle X (moves paddle left↔right via mouse up↔down)
        if (event.row === null) { mouseCol = null; return }
        const frac = event.row / ROWS
        mouseCol   = frac * (COLS - PADDLE_WIDTH)
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
          } else if (phase === 'win' || phase === 'gameover') {
            ball.speed = BALL_SPEED_INIT
            startGame()
          }
          return
        }
        if (key === 'ArrowLeft')  { arrowDelta = -1; mouseCol = null }
        if (key === 'ArrowRight') { arrowDelta =  1; mouseCol = null }
        if ((key === ' ' || key === 'Enter') && (phase === 'win' || phase === 'gameover')) {
          ball.speed = BALL_SPEED_INIT
          startGame()
        }
      }
      if (type === 'keyup') {
        if (key === 'ArrowLeft'  && arrowDelta === -1) arrowDelta = 0
        if (key === 'ArrowRight' && arrowDelta ===  1) arrowDelta = 0
      }
    },

    tick(dt) {
      if (phase === 'countdown') {
        phaseTimer += dt
        while (phaseTimer >= COUNTDOWN_STEP_MS) {
          phaseTimer -= COUNTDOWN_STEP_MS
          countdownN--
          if (countdownN <= 0) { phase = 'playing'; break }
        }
        drawFrame(true, DIM)
        if (phase === 'countdown') drawDigit(countdownN)
        return
      }
      if (phase === 'playing') {
        tickPlaying(dt)
        if (phase === 'playing' || phase === 'win') drawFrame()
        return
      }
      if (phase === 'paused') {
        drawFrame(true, DIM)
        return
      }
      if (phase === 'point') {
        phaseTimer += dt
        drawFrame(true, DIM)
        if (phaseTimer >= POINT_PAUSE_MS) startCountdown()
        return
      }
      if (phase === 'win') {
        api.clearGrid()
        // Celebration: sparse checkerboard
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            dot(c, r, (r + c) % 2 === 0 ? LIT : OFF)
        drawHUD()
        return
      }
      if (phase === 'gameover') {
        api.clearGrid()
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if ((r + c) % 3 === 0) dot(c, r, DIM)
        drawHUD()
        return
      }
    },

    destroy() { api = null },

    // ── Test-only helpers ──────────────────────────────────────────────────
    _getPhase()           { return phase },
    _getScore()           { return score },
    _getLives()           { return lives },
    _getBricksRemaining() { return bricksRemaining },
    _getBall()            { return { ...ball } },
    _getPaddle()          { return { ...paddle } },
    _setBall(x, y, vx, vy) { Object.assign(ball, { x, y, vx, vy }) },
    _setPaddleX(x)         { paddle.x = x },
    _forcePhase(p)         { phase = p },
  }
}
