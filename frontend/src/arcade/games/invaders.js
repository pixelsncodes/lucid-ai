import { OFF, DIM, LIT } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────

const COLS         = 24
const ROWS         = 16
const INV_COLS     = 5            // invader columns
const INV_ROWS     = 3            // invader rows
const INV_SPACING  = 4            // columns between invader centres
const INV_START_C  = 2            // leftmost invader column at rest
const INV_START_R  = 2            // topmost invader row at rest
const PLAYER_ROW   = ROWS - 2     // row 14
const LIVES_ROW    = ROWS - 1     // row 15 — live pips
const DANGER_ROW   = PLAYER_ROW   // if invaders reach this row, game over

// ── Timing / speed ────────────────────────────────────────────────────────────

const INV_STEP_INIT  = 0.9       // seconds between army steps (at full strength)
const INV_STEP_MIN   = 0.15      // minimum step interval (all invaders dead = irrelevant)
const BULLET_SPEED   = 10        // player bullet: dots/sec (upward)
const BOMB_SPEED     = 3.5       // invader bomb: dots/sec (downward)
const BOMB_INTERVAL  = 2.0       // seconds between random bomb drops
const LIVES_INIT     = 3
const COUNTDOWN_STEP_MS = 800

// ── Factory ───────────────────────────────────────────────────────────────────

export function createInvaders() {
  let api = null

  // Invader grid: alive[r][c] = true if alive
  let alive  = []
  let total  = INV_ROWS * INV_COLS
  let kills  = 0

  // Army offset from starting position
  let armyX  = 0   // column offset (integer, applied to invader draw)
  let armyDX = 1   // +1 = right, -1 = left
  let armyY  = 0   // row offset (integer steps down)
  let stepTimer = 0      // time until next army step (seconds)
  let stepInterval = INV_STEP_INIT

  // Player
  const player  = { x: Math.floor(COLS / 2) }
  let playerVX  = 0     // -1|0|1

  // Bullets & bombs
  const bullet  = { x: 0, y: 0, active: false }
  const bombs   = []    // [{x, y}]

  let bombTimer = BOMB_INTERVAL

  // Misc
  let lives      = LIVES_INIT
  let score      = 0
  let phase      = 'idle'   // idle|countdown|playing|dead|win
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

  // Absolute column of invader [r][c]
  function invCol(c) { return INV_START_C + c * INV_SPACING + armyX }
  function invRow(r) { return INV_START_R + r * 2 + armyY }

  // Leftmost / rightmost alive invader column
  function armyBounds() {
    let minC = INV_COLS, maxC = -1
    for (let r = 0; r < INV_ROWS; r++)
      for (let c = 0; c < INV_COLS; c++)
        if (alive[r][c]) { minC = Math.min(minC, c); maxC = Math.max(maxC, c) }
    return { minC, maxC }
  }

  // Lowest alive invader row (absolute)
  function lowestInvRow() {
    for (let r = INV_ROWS - 1; r >= 0; r--)
      for (let c = 0; c < INV_COLS; c++)
        if (alive[r][c]) return invRow(r)
    return -1
  }

  // Pick a random alive invader from the bottom of each column (classic invader bombing)
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
    const frac  = alive_count / total  // 1.0 = full, 0 = none
    stepInterval = Math.max(INV_STEP_MIN, INV_STEP_INIT * frac)
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawHUD() {
    // Row 0: score pips (LIT per kill)
    const lit = Math.min(kills, COLS)
    for (let i = 0; i < COLS; i++) dot(i, 0, i < lit ? LIT : DIM)
    // Bottom row: life pips
    for (let i = 0; i < LIVES_INIT; i++) dot(i, LIVES_ROW, i < lives ? LIT : DIM)
  }

  function drawArmy() {
    for (let r = 0; r < INV_ROWS; r++) {
      for (let c = 0; c < INV_COLS; c++) {
        if (!alive[r][c]) continue
        const ic = invCol(c), ir = invRow(r)
        if (ic >= 0 && ic < COLS && ir >= 0 && ir < ROWS) dot(ic, ir, LIT)
      }
    }
  }

  function drawPlayer() {
    if (player.x >= 0 && player.x < COLS) dot(player.x, PLAYER_ROW, LIT)
  }

  function drawBullet() {
    if (bullet.active) {
      const bx = Math.round(bullet.x), by = Math.round(bullet.y)
      if (bx >= 0 && bx < COLS && by >= 0 && by < ROWS) dot(bx, by, LIT)
    }
  }

  function drawBombs() {
    for (const b of bombs) {
      const bx = Math.round(b.x), by = Math.round(b.y)
      if (bx >= 0 && bx < COLS && by >= 0 && by < ROWS) dot(bx, by, DIM)
    }
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  function tickPlaying(dt) {
    const dtS = dt / 1000

    // ── Player movement ──
    player.x = clamp(player.x + playerVX * Math.round(14 * dtS + 0.5), 0, COLS - 1)

    // ── Bullet ──
    if (bullet.active) {
      bullet.y -= BULLET_SPEED * dtS
      if (bullet.y < 0) { bullet.active = false }

      // Bullet vs invader
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

    // ── Bombs ──
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

      // Bomb hits player
      if (bx === player.x && by === PLAYER_ROW) {
        bombs.splice(i, 1)
        playerHit()
        return
      }

      // near_miss: bomb passed within 1 col of player at player row
      if (Math.abs(bx - player.x) <= 1 && by === PLAYER_ROW) {
        api.emit('near_miss', { bombX: bx, playerX: player.x })
      }

      if (bombs[i] && bombs[i].y > ROWS) bombs.splice(i, 1)
    }

    // ── Army march ──
    stepTimer -= dtS
    if (stepTimer <= 0) {
      stepTimer = stepInterval

      // Try stepping in current direction
      const { minC, maxC } = armyBounds()
      const leftEdge  = invCol(minC) + armyDX
      const rightEdge = invCol(maxC) + armyDX

      if (leftEdge < 0 || rightEdge >= COLS) {
        // Hit an edge: reverse and drop
        armyDX = -armyDX
        armyY++
        // Check if any invader reached the danger row
        if (lowestInvRow() >= DANGER_ROW) {
          phase = 'gameover'
          api.emit('scrap_won', { score, reason: 'invasion' })
          return
        }
      } else {
        armyX += armyDX
      }

      // Check invasion after any step (not only on drops)
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

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'invaders',
      name:     'INVADERS',
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
        if (key === 'ArrowLeft')  playerVX = -1
        if (key === 'ArrowRight') playerVX =  1
        if (key === ' ' && phase === 'playing' && !bullet.active) {
          bullet.x      = player.x
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
        api.clearGrid()
        drawHUD()
        drawArmy()
        drawPlayer()
        return
      }

      if (phase === 'playing') {
        tickPlaying(dt)
        if (phase === 'playing') {
          api.clearGrid()
          drawHUD()
          drawArmy()
          drawPlayer()
          drawBullet()
          drawBombs()
        }
        return
      }

      if (phase === 'paused') {
        api.clearGrid()
        drawHUD()
        drawArmy()
        drawPlayer()
        return
      }

      if (phase === 'dead') {
        // Brief flash then respawn
        phaseTimer += dt
        api.clearGrid()
        drawHUD()
        drawArmy()
        if (phaseTimer >= 1000) {
          phase = 'playing'
          bullet.active = false
        }
        return
      }

      if (phase === 'win') {
        api.clearGrid()
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if ((r + c) % 2 === 0) dot(c, r, LIT)
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
