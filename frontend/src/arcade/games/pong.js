// ── Canvas Pong ───────────────────────────────────────────────────────────────
// Classic white-on-black. Renders via render(ctx, {w, h}); tick() is logic only.

// ── Layout ────────────────────────────────────────────────────────────────────

const LOGICAL_W  = 640
const LOGICAL_H  = 384

const BALL_SIZE  = 10
const BALL_HALF  = BALL_SIZE / 2

const PAD_W      = 10
const PAD_H      = 64
const PAD_OFFSET = 18    // gap from wall to near edge of paddle

const PLAYER_X = PAD_OFFSET                        // left edge of player paddle
const AI_X     = LOGICAL_W - PAD_OFFSET - PAD_W   // left edge of AI paddle

// Planes the ball center must cross to trigger a paddle collision
const PLAYER_PLANE = PLAYER_X + PAD_W   // right face of player paddle
const AI_PLANE     = AI_X               // left  face of AI paddle

// ── Ball ─────────────────────────────────────────────────────────────────────

const BALL_SPEED_INIT = 280    // px/sec
const BALL_SPEED_MAX  = 540    // px/sec
const BALL_SPEED_BUMP = 1.035  // multiplier per paddle hit

// ── AI ───────────────────────────────────────────────────────────────────────

const AI_MAX_PX_PER_FRAME = 3.7   // speed cap — keeps it beatable at high rallies

// ── Player ───────────────────────────────────────────────────────────────────

const PADDLE_SPEED = 200   // px/sec for arrow keys

// ── Events ───────────────────────────────────────────────────────────────────

const NEAR_MISS_DIST = 10  // px from paddle edge → near_miss on exit

// ── Game rules ───────────────────────────────────────────────────────────────

const WIN_SCORE         = 7
const COUNTDOWN_STEP_MS = 1000
const POINT_PAUSE_MS    = 1200

// ── Net ──────────────────────────────────────────────────────────────────────

const NET_DASH = [10, 8]

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPong() {
  let api = null

  let phase      = 'idle'     // idle|countdown|playing|point|win|quit
  let phaseTimer = 0
  let countdownN = 3
  let playerScore = 0
  let scrapScore  = 0

  const ball      = { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_SPEED_INIT }
  const playerPad = { y: (LOGICAL_H - PAD_H) / 2 }
  const aiPad     = { y: (LOGICAL_H - PAD_H) / 2 }

  let mouseY     = null   // logical Y; null → arrow key mode
  let arrowDelta = 0      // -1 | 0 | +1
  let aiNoise    = 0

  // ── Helpers ──────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function resetPositions() {
    playerPad.y = (LOGICAL_H - PAD_H) / 2
    aiPad.y     = (LOGICAL_H - PAD_H) / 2
  }

  function resetBall(serveDir) {
    ball.x = LOGICAL_W / 2
    ball.y = LOGICAL_H / 2
    const angle = (Math.random() * 40 + 20) * (Math.PI / 180)
    ball.vx = serveDir * Math.cos(angle) * ball.speed
    ball.vy = (Math.random() < 0.5 ? 1 : -1) * Math.sin(angle) * ball.speed
  }

  function startGame() {
    playerScore = 0
    scrapScore  = 0
    ball.speed  = BALL_SPEED_INIT
    mouseY      = null
    arrowDelta  = 0
    aiNoise     = 0
    resetPositions()
    startCountdown(1)
    api.emit('game_start', { game: 'pong' })
  }

  function startCountdown(serveDir) {
    resetBall(serveDir)
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
  }

  function applySpin(paddleTop) {
    const offset = (ball.y - (paddleTop + PAD_H / 2)) / (PAD_H / 2)
    ball.vy    += offset * 80
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

  // ── Physics ───────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // Player paddle
    if (mouseY !== null) {
      playerPad.y = clamp(mouseY - PAD_H / 2, 0, LOGICAL_H - PAD_H)
    } else {
      playerPad.y = clamp(
        playerPad.y + arrowDelta * PADDLE_SPEED * dtS,
        0, LOGICAL_H - PAD_H,
      )
    }

    // AI paddle — capped tracking speed keeps it beatable at high rally speeds
    aiNoise = aiNoise * 0.92 + (Math.random() - 0.5) * 6
    aiNoise = clamp(aiNoise, -12, 12)
    const aiTarget = ball.y - PAD_H / 2 + aiNoise
    const aiDelta  = aiTarget - aiPad.y
    aiPad.y = clamp(
      aiPad.y + Math.sign(aiDelta) * Math.min(Math.abs(aiDelta), AI_MAX_PX_PER_FRAME),
      0, LOGICAL_H - PAD_H,
    )

    // Ball movement
    const prevX = ball.x
    ball.x += ball.vx * dtS
    ball.y += ball.vy * dtS

    // Wall bounces (top/bottom)
    if (ball.y - BALL_HALF < 0) {
      ball.y  = 2 * BALL_HALF - ball.y
      ball.vy = Math.abs(ball.vy)
    }
    if (ball.y + BALL_HALF > LOGICAL_H) {
      ball.y  = 2 * (LOGICAL_H - BALL_HALF) - ball.y
      ball.vy = -Math.abs(ball.vy)
    }

    // Player paddle collision (ball moving left, crossing PLAYER_PLANE)
    if (ball.vx < 0 && prevX > PLAYER_PLANE && ball.x <= PLAYER_PLANE) {
      const py = playerPad.y
      if (ball.y >= py - BALL_HALF && ball.y <= py + PAD_H + BALL_HALF) {
        ball.x  = 2 * PLAYER_PLANE - ball.x
        ball.vx = Math.abs(ball.vx)
        applySpin(py)
        if (
          Math.abs(ball.y - py) < NEAR_MISS_DIST ||
          Math.abs(ball.y - (py + PAD_H)) < NEAR_MISS_DIST
        ) api.emit('near_miss', { side: 'player' })
      }
    }

    // AI paddle collision (ball moving right, crossing AI_PLANE)
    if (ball.vx > 0 && prevX < AI_PLANE && ball.x >= AI_PLANE) {
      const ay = aiPad.y
      if (ball.y >= ay - BALL_HALF && ball.y <= ay + PAD_H + BALL_HALF) {
        ball.x  = 2 * AI_PLANE - ball.x
        ball.vx = -Math.abs(ball.vx)
        applySpin(ay)
        if (
          Math.abs(ball.y - ay) < NEAR_MISS_DIST ||
          Math.abs(ball.y - (ay + PAD_H)) < NEAR_MISS_DIST
        ) api.emit('near_miss', { side: 'scrap' })
      }
    }

    // Scoring — check near_miss on exit (ball slipped past a paddle edge)
    if (ball.x < 0) {
      const distTop = Math.abs(ball.y - playerPad.y)
      const distBot = Math.abs(ball.y - (playerPad.y + PAD_H))
      if (distTop < NEAR_MISS_DIST || distBot < NEAR_MISS_DIST) {
        api.emit('near_miss', { side: 'player' })
      }
      scrapScore++
      api.emit('scrap_scored', { playerScore, scrapScore })
      checkWin(-1)
    } else if (ball.x > LOGICAL_W) {
      const distTop = Math.abs(ball.y - aiPad.y)
      const distBot = Math.abs(ball.y - (aiPad.y + PAD_H))
      if (distTop < NEAR_MISS_DIST || distBot < NEAR_MISS_DIST) {
        api.emit('near_miss', { side: 'scrap' })
      }
      playerScore++
      api.emit('player_scored', { playerScore, scrapScore })
      checkWin(1)
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Center net — dashed vertical line
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.setLineDash(NET_DASH)
    ctx.beginPath()
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w / 2, h)
    ctx.stroke()
    ctx.setLineDash([])

    // Scores — large monospace either side of the net
    ctx.fillStyle = '#fff'
    ctx.font = '52px monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'right'
    ctx.fillText(String(playerScore), w / 2 - 28, 24)
    ctx.textAlign = 'left'
    ctx.fillText(String(scrapScore),  w / 2 + 28, 24)

    // Paddles
    ctx.fillStyle = '#fff'
    ctx.fillRect(PLAYER_X, playerPad.y, PAD_W, PAD_H)
    ctx.fillRect(AI_X,     aiPad.y,     PAD_W, PAD_H)

    // Ball
    if (phase === 'playing') {
      ctx.fillStyle = '#fff'
      ctx.fillRect(ball.x - BALL_HALF, ball.y - BALL_HALF, BALL_SIZE, BALL_SIZE)
    } else if (phase === 'point') {
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.fillRect(ball.x - BALL_HALF, ball.y - BALL_HALF, BALL_SIZE, BALL_SIZE)
    }

    // Countdown overlay
    if (phase === 'countdown') {
      ctx.fillStyle = '#fff'
      ctx.font = '96px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(countdownN), w / 2, h / 2)
    }

    // Win screen
    if (phase === 'win') {
      ctx.fillStyle = '#fff'
      ctx.font = '48px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(playerScore >= WIN_SCORE ? 'YOU WIN' : 'SCRAP WINS', w / 2, h / 2 - 32)
      ctx.font = '20px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.fillText('space to play again', w / 2, h / 2 + 20)
    }

    // Quit screen
    if (phase === 'quit') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'
      ctx.font = '32px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GAME QUIT', w / 2, h / 2 - 20)
      ctx.font = '18px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to restart', w / 2, h / 2 + 20)
    }
  }

  // ── Contract ─────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'pong',
      name:          'PONG',
      renderer:      'canvas',
      logicalWidth:  LOGICAL_W,
      logicalHeight: LOGICAL_H,
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type === 'mouse_y' || event.type === 'touch_y') {
        mouseY = event.row
        return
      }
      if (event.type !== 'keydown' && event.type !== 'keyup') return
      const { key, type } = event

      if (type === 'keydown') {
        if (key === 'Escape') {
          if (phase === 'playing' || phase === 'countdown' || phase === 'point') {
            phase = 'quit'
            api.emit('game_quit', { playerScore, scrapScore })
          } else if (phase === 'win' || phase === 'quit') {
            ball.speed = BALL_SPEED_INIT
            startGame()
          }
          return
        }
        if (key === ' ' || key === 'Enter') {
          if (phase === 'win' || phase === 'quit') {
            ball.speed = BALL_SPEED_INIT
            startGame()
          }
          return
        }
        if (key === 'ArrowUp')   { arrowDelta = -1; mouseY = null }
        if (key === 'ArrowDown') { arrowDelta =  1; mouseY = null }
      }
      if (type === 'keyup') {
        if (key === 'ArrowUp'   && arrowDelta === -1) arrowDelta = 0
        if (key === 'ArrowDown' && arrowDelta ===  1) arrowDelta = 0
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
      } else if (phase === 'playing') {
        tickPlaying(dt)
      } else if (phase === 'point') {
        phaseTimer += dt
        if (phaseTimer >= POINT_PAUSE_MS) startCountdown(ball.vx > 0 ? 1 : -1)
      }
    },

    render,

    destroy() { api = null },

    // ── Test helpers ─────────────────────────────────────────────────────
    _getPhase()        { return phase },
    _getBall()         { return { ...ball } },
    _getScores()       { return { playerScore, scrapScore } },
    _setPhase(p)       { phase = p },
    _setBall(b)        { Object.assign(ball, b) },
    _setPlayerPad(p)   { Object.assign(playerPad, p) },
    _setAiPad(p)       { Object.assign(aiPad, p) },
    _setScores({ playerScore: ps, scrapScore: ss }) {
      playerScore = ps
      scrapScore  = ss
    },
  }
}
