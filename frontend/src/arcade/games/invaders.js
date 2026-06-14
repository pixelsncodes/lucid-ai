// ── Canvas Invaders ───────────────────────────────────────────────────────────
// Classic white-on-black. Renders via render(ctx, {w, h}); tick() is logic only.
// All positions stay in grid-coordinate space; render() scales to logical pixels.

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS         = 24
const ROWS         = 16
const INV_COLS     = 8
const INV_ROWS     = 4
const INV_SPACING  = 2
const INV_START_C  = 4
const INV_START_R  = 2
const PLAYER_ROW   = ROWS - 2     // row 14
const LIVES_ROW    = ROWS - 1     // row 15
const DANGER_ROW   = PLAYER_ROW

const LOGICAL_W = 480
const LOGICAL_H = 320

// ── Timing / speed ────────────────────────────────────────────────────────────

const INV_STEP_INIT  = 0.9
const INV_STEP_MIN   = 0.15
const BULLET_SPEED   = 10
const BOMB_SPEED     = 3.5
const BOMB_INTERVAL  = 2.0
const PLAYER_SPEED   = 11    // cells/sec — crosses ~24-col field in ~2 s
const LIVES_INIT     = 3
const COUNTDOWN_STEP_MS = 800

// ── Factory ───────────────────────────────────────────────────────────────────

export function createInvaders() {
  let api = null

  let alive  = []
  let total  = INV_ROWS * INV_COLS
  let kills  = 0

  let armyX  = 0
  let armyDX = 1
  let armyY  = 0
  let stepTimer    = 0
  let stepInterval = INV_STEP_INIT

  const player  = { x: Math.floor(COLS / 2) }
  let playerVX  = 0

  const bullet  = { x: 0, y: 0, active: false }
  const bombs   = []

  let bombTimer = BOMB_INTERVAL

  let lives      = LIVES_INIT
  let score      = 0
  let phase      = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function initArmy() {
    alive = []
    for (let r = 0; r < INV_ROWS; r++) {
      alive[r] = []
      for (let c = 0; c < INV_COLS; c++) alive[r][c] = true
    }
    total   = INV_ROWS * INV_COLS
    kills   = 0
    armyX   = 0
    armyDX  = 1
    armyY   = 0
    stepTimer    = stepInterval = INV_STEP_INIT
    bombTimer    = BOMB_INTERVAL
  }

  function startGame() {
    initArmy()
    player.x  = Math.floor(COLS / 2)
    playerVX  = 0
    bullet.active = false
    bombs.length  = 0
    lives    = LIVES_INIT
    score    = 0
    phase    = 'countdown'
    countdownN = 3
    phaseTimer = 0
    api.emit('game_start', { game: 'invaders' })
  }

  function invCol(c) { return INV_START_C + c * INV_SPACING + armyX }
  function invRow(r) { return INV_START_R + r * 2 + armyY }

  function armyBounds() {
    let minC = INV_COLS, maxC = -1
    for (let r = 0; r < INV_ROWS; r++)
      for (let c = 0; c < INV_COLS; c++)
        if (alive[r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c) }
    return { minC, maxC }
  }

  function lowestInvRow() {
    for (let r = INV_ROWS - 1; r >= 0; r--)
      for (let c = 0; c < INV_COLS; c++)
        if (alive[r][c]) return invRow(r)
    return -1
  }

  function pickBomber() {
    const cols = []
    for (let c = 0; c < INV_COLS; c++) {
      for (let r = INV_ROWS - 1; r >= 0; r--) {
        if (alive[r][c]) { cols.push({ r, c }); break }
      }
    }
    if (!cols.length) return null
    return cols[Math.floor(Math.random() * cols.length)]
  }

  function adjustSpeed() {
    const alive_count = total - kills
    const frac  = alive_count / total
    stepInterval = Math.max(INV_STEP_MIN, INV_STEP_INIT * frac)
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // Player movement — continuous float position; no more per-frame rounding
    player.x = clamp(player.x + playerVX * PLAYER_SPEED * dtS, 0, COLS - 1)

    // Bullet
    if (bullet.active) {
      bullet.y -= BULLET_SPEED * dtS
      if (bullet.y < 0) { bullet.active = false }

      if (bullet.active) {
        const bx = Math.round(bullet.x), by = Math.round(bullet.y)
        outer: for (let r = 0; r < INV_ROWS; r++) {
          for (let c = 0; c < INV_COLS; c++) {
            if (!alive[r][c]) continue
            if (invCol(c) === bx && invRow(r) === by) {
              alive[r][c] = false
              kills++
              score++
              bullet.active = false
              adjustSpeed()
              api.emit('player_scored', { score, kills, remaining: total - kills })
              if (kills === total) {
                phase = 'win'
                api.emit('scrap_lost', { score })
                return
              }
              break outer
            }
          }
        }
      }
    }

    // Bombs
    bombTimer -= dtS
    if (bombTimer <= 0) {
      bombTimer = BOMB_INTERVAL * (0.8 + Math.random() * 0.4)
      if (bombs.length < 3) {
        const bomber = pickBomber()
        if (bomber) bombs.push({ x: invCol(bomber.c), y: invRow(bomber.r) + 1 })
      }
    }

    for (let i = bombs.length - 1; i >= 0; i--) {
      bombs[i].y += BOMB_SPEED * dtS

      const bx = Math.round(bombs[i].x), by = Math.round(bombs[i].y)

      if (bx === Math.round(player.x) && by === PLAYER_ROW) {
        bombs.splice(i, 1)
        playerHit()
        return
      }

      if (Math.abs(bx - player.x) <= 1 && by === PLAYER_ROW) {
        api.emit('near_miss', { bombX: bx, playerX: player.x })
      }

      if (bombs[i] && bombs[i].y > ROWS) bombs.splice(i, 1)
    }

    // Army march
    stepTimer -= dtS
    if (stepTimer <= 0) {
      stepTimer = stepInterval

      const { minC, maxC } = armyBounds()
      const leftEdge  = invCol(minC) + armyDX
      const rightEdge = invCol(maxC) + armyDX

      if (leftEdge < 0 || rightEdge >= COLS) {
        armyDX = -armyDX
        armyY++
        if (lowestInvRow() >= DANGER_ROW) {
          phase = 'gameover'
          api.emit('scrap_won', { score, reason: 'invasion' })
          return
        }
      } else {
        armyX += armyDX
      }

      if (lowestInvRow() >= DANGER_ROW) {
        phase = 'gameover'
        api.emit('scrap_won', { score, reason: 'invasion' })
        return
      }
    }
  }

  function playerHit() {
    lives--
    if (lives <= 0) {
      phase = 'gameover'
      api.emit('scrap_won', { score, reason: 'lives' })
    } else {
      phase      = 'dead'
      phaseTimer = 0
      bullet.active = false
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    const cellW = w / COLS
    const cellH = h / ROWS

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Score top-left
    ctx.fillStyle = '#fff'
    ctx.font = '13px monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText(`${score}`, 6, 4)

    // Lives bottom-left
    ctx.textBaseline = 'bottom'
    ctx.fillText('♥ '.repeat(lives).trim(), 6, h - 4)

    // Invader army — each invader: blocky rect with "antenna" notch on top row
    for (let r = 0; r < INV_ROWS; r++) {
      for (let c = 0; c < INV_COLS; c++) {
        if (!alive[r][c]) continue
        const ic = invCol(c), ir = invRow(r)
        if (ic < 0 || ic >= COLS || ir < 0 || ir >= ROWS) continue
        const px = ic * cellW, py = ir * cellH
        // Body
        ctx.fillStyle = '#fff'
        ctx.fillRect(px + 2, py + 4, cellW - 4, cellH - 6)
        // "Legs" — two small protrusions at bottom
        ctx.fillRect(px + 1,        py + cellH - 4, 4, 3)
        ctx.fillRect(px + cellW - 5, py + cellH - 4, 4, 3)
        // "Eyes"
        ctx.fillStyle = '#000'
        ctx.fillRect(px + 4,        py + 6, 3, 3)
        ctx.fillRect(px + cellW - 7, py + 6, 3, 3)
      }
    }

    // Player cannon
    const px = player.x * cellW
    const py = PLAYER_ROW * cellH
    ctx.fillStyle = '#fff'
    // Base
    ctx.fillRect(px - cellW * 0.6, py + cellH * 0.4, cellW * 2.2, cellH * 0.5)
    // Barrel
    ctx.fillRect(px + cellW * 0.3, py + cellH * 0.1, cellW * 0.4, cellH * 0.4)

    // Player bullet
    if (bullet.active) {
      ctx.fillStyle = '#fff'
      ctx.fillRect(bullet.x * cellW + cellW * 0.4, bullet.y * cellH, 2, cellH)
    }

    // Enemy bombs
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    for (const b of bombs) {
      ctx.fillRect(b.x * cellW + cellW * 0.3, b.y * cellH, 4, 4)
    }

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
      ctx.fillText('INVADED', w / 2, h / 2 - 28)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to play again', w / 2, h / 2 + 20)
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'invaders',
      name:          'INVADERS',
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
        if (key === 'ArrowLeft')  playerVX = -1
        if (key === 'ArrowRight') playerVX =  1
        if (key === ' ' && phase === 'playing' && !bullet.active) {
          bullet.x      = Math.round(player.x)
          bullet.y      = PLAYER_ROW - 1
          bullet.active = true
        }
        if (key === 'Escape') {
          if (phase === 'playing') {
            phase = 'paused'
          } else if (phase === 'paused') {
            phase = 'playing'
          } else if (phase === 'win' || phase === 'gameover') {
            startGame()
          }
        }
        if ((key === ' ' || key === 'Enter') && (phase === 'win' || phase === 'gameover')) {
          startGame()
        }
      }
      if (type === 'keyup') {
        if (key === 'ArrowLeft'  && playerVX === -1) playerVX = 0
        if (key === 'ArrowRight' && playerVX ===  1) playerVX = 0
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

      if (phase === 'dead') {
        phaseTimer += dt
        if (phaseTimer >= 1000) {
          phase = 'playing'
          bullet.active = false
        }
        return
      }
    },

    render,

    destroy() { api = null },

    // ── Test-only helpers ──────────────────────────────────────────────────
    _getPhase()       { return phase },
    _getScore()       { return score },
    _getLives()       { return lives },
    _getKills()       { return kills },
    _getAlive()       { return alive.map(row => [...row]) },
    _getPlayer()      { return { ...player } },
    _getBullet()               { return { ...bullet } },
    _setBullet(x, y, active)   { bullet.x = x; bullet.y = y; bullet.active = active },
    _getBombs()       { return bombs.map(b => ({ ...b })) },
    _setArmyX(x)      { armyX = x },
    _setArmyY(y)      { armyY = y },
    _forcePhase(p)    { phase = p },
    _spawnBomb(x, y)  { bombs.push({ x, y }) },
    _killAllBut(r, c) {
      for (let ri = 0; ri < INV_ROWS; ri++)
        for (let ci = 0; ci < INV_COLS; ci++)
          if (ri !== r || ci !== c) {
            if (alive[ri][ci]) { alive[ri][ci] = false; kills++ }
          }
      total = INV_ROWS * INV_COLS
      adjustSpeed()
    },
  }
}
