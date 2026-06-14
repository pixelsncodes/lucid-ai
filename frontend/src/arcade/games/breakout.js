// ── Canvas Breakout ───────────────────────────────────────────────────────────
// Classic white-on-black. Renders via render(ctx, {w, h}); tick() is logic only.
// Ball and paddle physics stay in grid-coordinate space (0..COLS, 0..ROWS);
// render() scales to logical pixels via cellW / cellH.

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS         = 24
const ROWS         = 16
const BRICK_ROW_1  = 1          // first brick row
const BRICK_ROW_N  = 5          // last brick row (5 rows × 24 bricks = 120)
const BRICK_COL_1  = 0
const BRICK_COL_N  = COLS - 1   // cols 0..23
const PADDLE_ROW   = ROWS - 1   // row 15
const PADDLE_WIDTH = 4

const LOGICAL_W = 480
const LOGICAL_H = 320

// ── Ball ─────────────────────────────────────────────────────────────────────

const BALL_SPEED_INIT = 9    // dots/sec
const BALL_SPEED_MAX  = 16
const BALL_SPEED_BUMP = 1.06
const SERVE_ANGLE_MIN = 0.3

// ── Pixel-to-grid geometry ────────────────────────────────────────────────────
// Ball is drawn as an 8px square sprite (±4px); at cellH = LOGICAL_H/ROWS = 20px
// the radius is 4px / 20px = 0.2 cells.  PADDLE_TOP is the grid-coord top edge of
// the paddle rect, shared by both the physics plane and the render call so they
// never diverge.

const BALL_RADIUS_CELLS = 4 / (LOGICAL_H / ROWS)    // 0.2 cells — sprite is ±4px in a 20px cell
const PADDLE_TOP        = PADDLE_ROW + 0.35          // grid-coord top edge of paddle
const BRICK_HIT_HALF    = 0.5 + BALL_RADIUS_CELLS   // 0.7 — brick half + ball radius

// ── Timing ───────────────────────────────────────────────────────────────────

const LIVES_INIT        = 3
const COUNTDOWN_STEP_MS = 800
const POINT_PAUSE_MS    = 1000

// ── Factory ───────────────────────────────────────────────────────────────────

export function createBreakout() {
  let api = null

  let bricks           = []
  let bricksRemaining  = 0

  const ball   = { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT }
  const paddle = { x: 0 }   // left-edge column (float, grid coords)

  let lives      = LIVES_INIT
  let score      = 0
  let phase      = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  let arrowDelta = 0

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
    const angle = (Math.random() * Math.PI * 0.4) + SERVE_ANGLE_MIN
    const sign  = Math.random() < 0.5 ? 1 : -1
    ball.vx = sign * Math.sin(angle) * ball.speed
    ball.vy = -Math.abs(Math.cos(angle)) * ball.speed
  }

  function startGame() {
    initBricks()
    lives      = LIVES_INIT
    score      = 0
    ball.speed = BALL_SPEED_INIT
    arrowDelta = 0
    startCountdown()
    api.emit('game_start', { game: 'breakout' })
  }

  function startCountdown() {
    serveBall()
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // Paddle movement
    paddle.x = clamp(paddle.x + arrowDelta * 14 * dtS, 0, COLS - PADDLE_WIDTH)

    const prevX = ball.x, prevY = ball.y
    ball.x += ball.vx * dtS
    ball.y += ball.vy * dtS

    // Left/right walls — radius-aware, symmetric: ball edge bounces at pixel 0 / COLS
    if (ball.x - BALL_RADIUS_CELLS < 0) {
      ball.x  = 2 * BALL_RADIUS_CELLS - ball.x
      ball.vx = Math.abs(ball.vx)
    }
    if (ball.x + BALL_RADIUS_CELLS > COLS) {
      ball.x  = 2 * (COLS - BALL_RADIUS_CELLS) - ball.x
      ball.vx = -Math.abs(ball.vx)
    }

    // Top wall
    if (ball.y < BRICK_ROW_1 - 0.5) {
      ball.y  = 2*(BRICK_ROW_1 - 0.5) - ball.y
      ball.vy = Math.abs(ball.vy)
    }

    // Brick collision — radius-based AABB; minimum-overlap axis bounce
    outer:
    for (let br = Math.floor(ball.y - BALL_RADIUS_CELLS); br <= Math.ceil(ball.y + BALL_RADIUS_CELLS); br++) {
      for (let bc = Math.floor(ball.x - BALL_RADIUS_CELLS); bc <= Math.ceil(ball.x + BALL_RADIUS_CELLS); bc++) {
        if (br < BRICK_ROW_1 || br > BRICK_ROW_N || bc < BRICK_COL_1 || bc > BRICK_COL_N) continue
        if (!bricks[br]?.[bc]) continue
        const ovX = BRICK_HIT_HALF - Math.abs(ball.x - bc)
        const ovY = BRICK_HIT_HALF - Math.abs(ball.y - br)
        if (ovX <= 0 || ovY <= 0) continue
        bricks[br][bc] = false
        bricksRemaining--
        score++
        api.emit('player_scored', { score, bricksRemaining })
        if (ovX < ovY) {
          ball.vx = -ball.vx
          ball.x += Math.sign(ball.x - bc) * ovX
        } else {
          ball.vy = -ball.vy
          ball.y += Math.sign(ball.y - br) * ovY
        }
        if (bricksRemaining === 0) { phase = 'win'; api.emit('scrap_lost', { score }); return }
        break outer
      }
    }

    // Paddle collision — ball bottom edge vs PADDLE_TOP (same coord used in render)
    const paddleLeft  = paddle.x
    const paddleRight = paddle.x + PADDLE_WIDTH - 1
    if (ball.vy > 0 && prevY + BALL_RADIUS_CELLS < PADDLE_TOP && ball.y + BALL_RADIUS_CELLS >= PADDLE_TOP) {
      if (ball.x >= paddleLeft - 0.5 && ball.x <= paddleRight + 0.5) {
        ball.y  = PADDLE_TOP - BALL_RADIUS_CELLS
        ball.vy = -Math.abs(ball.vy)
        const offset  = (ball.x - (paddleLeft + (PADDLE_WIDTH - 1) / 2)) / (PADDLE_WIDTH / 2)
        ball.vx      += offset * 2
        const mag     = Math.hypot(ball.vx, ball.vy)
        ball.speed    = Math.min(ball.speed * BALL_SPEED_BUMP, BALL_SPEED_MAX)
        ball.vx       = (ball.vx / mag) * ball.speed
        ball.vy       = (ball.vy / mag) * ball.speed
        const edgeDist = Math.min(Math.abs(ball.x - paddleLeft), Math.abs(ball.x - paddleRight))
        if (edgeDist < 0.8) api.emit('near_miss', { side: offset < 0 ? 'left' : 'right' })
      } else {
        loseLife()
      }
    }

    if (ball.y > PADDLE_TOP + 1) loseLife()
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

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    const cellW = w / COLS
    const cellH = h / ROWS

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // HUD — lives top-left, score top-right
    ctx.fillStyle = '#fff'
    ctx.font = '13px monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(`♥ ${lives}`, 6, 4)
    ctx.textAlign = 'right'
    ctx.fillText(`${score}`, w - 6, 4)

    // Bricks
    ctx.fillStyle = '#fff'
    for (let r = BRICK_ROW_1; r <= BRICK_ROW_N; r++) {
      for (let c = BRICK_COL_1; c <= BRICK_COL_N; c++) {
        if (!bricks[r][c]) continue
        ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2)
      }
    }

    // Ball (dim when not actively playing)
    const ballVisible = phase === 'playing' || phase === 'point' || phase === 'countdown'
      || phase === 'paused' || phase === 'win'
    if (ballVisible) {
      const alpha = (phase === 'point' || phase === 'countdown') ? 0.3 : 1
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillRect(ball.x * cellW - 4, ball.y * cellH - 4, 8, 8)
    }

    // Paddle — padY uses PADDLE_TOP so render matches the collision plane exactly
    const padX = paddle.x * cellW
    const padY = PADDLE_TOP * cellH
    ctx.fillStyle = '#fff'
    ctx.fillRect(padX, padY, PADDLE_WIDTH * cellW - 1, cellH * 0.45)

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
      ctx.font = '36px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('PAUSED', w / 2, h / 2)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('esc to resume', w / 2, h / 2 + 34)
    }

    // Win screen
    if (phase === 'win') {
      ctx.fillStyle = '#fff'
      ctx.font = '44px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('YOU WIN', w / 2, h / 2 - 28)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to play again', w / 2, h / 2 + 20)
    }

    // Game-over screen
    if (phase === 'gameover') {
      ctx.fillStyle = '#fff'
      ctx.font = '36px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GAME OVER', w / 2, h / 2 - 28)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to play again', w / 2, h / 2 + 20)
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'breakout',
      name:          'BREAKOUT',
      renderer:      'canvas',
      logicalWidth:  LOGICAL_W,
      logicalHeight: LOGICAL_H,
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
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
        if (key === 'ArrowLeft')  arrowDelta = -1
        if (key === 'ArrowRight') arrowDelta =  1
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
        return
      }
      if (phase === 'playing') {
        tickPlaying(dt)
        return
      }
      if (phase === 'point') {
        phaseTimer += dt
        if (phaseTimer >= POINT_PAUSE_MS) startCountdown()
        return
      }
    },

    render,

    destroy() { api = null },

    // ── Test-only helpers ──────────────────────────────────────────────────
    _getPhase()           { return phase },
    _getScore()           { return score },
    _getLives()           { return lives },
    _getBricksRemaining() { return bricksRemaining },
    _getBall()            { return { ...ball } },
    _getPaddle()          { return { ...paddle } },
    _setBall(x, y, vx, vy) { Object.assign(ball, { x, y, vx, vy }) },
    _setPaddleX(x)          { paddle.x = x },
    _forcePhase(p)          { phase = p },
  }
}
