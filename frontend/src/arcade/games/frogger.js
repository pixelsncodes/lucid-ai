// ── Canvas Frogger ────────────────────────────────────────────────────────────
// Hybrid: frog hops in discrete row steps; cars/logs move continuously.
// Renders via render(ctx, {w, h}); tick() is pure logic.

// ── Layout ────────────────────────────────────────────────────────────────────
//
//  Row  0 : goal strip — 5 lily pads at cols 1,4,7,10,13; water between
//  Rows 1-5 : river lanes (frog must ride a log)
//  Row  6 : safe median strip
//  Rows 7-11: road lanes (frog must dodge cars)
//  Row 12 : safe home row (frog spawns here)

const COLS     = 16
const ROWS     = 13
const HOME_ROW = ROWS - 1   // row 12
const GOAL_ROW = 0

const PAD_COLS = [1, 4, 7, 10, 13]

const LOGICAL_W = 320
const LOGICAL_H = 260

// ── Lane definitions ──────────────────────────────────────────────────────────

const LANES = [
  // River
  { row: 1, type: 'river', speed: 3.0,  dir: +1, items: [{ col:  0, len: 4 }, { col:  9, len: 3 }] },
  { row: 2, type: 'river', speed: 2.0,  dir: -1, items: [{ col:  1, len: 3 }, { col:  8, len: 4 }, { col: 14, len: 2 }] },
  { row: 3, type: 'river', speed: 3.5,  dir: +1, items: [{ col:  2, len: 3 }, { col: 10, len: 3 }] },
  { row: 4, type: 'river', speed: 2.5,  dir: -1, items: [{ col:  0, len: 5 }, { col: 11, len: 3 }] },
  { row: 5, type: 'river', speed: 1.5,  dir: +1, items: [{ col:  1, len: 2 }, { col:  6, len: 3 }, { col: 12, len: 2 }] },
  // Road
  { row: 7, type: 'road',  speed: 4.0,  dir: -1, items: [{ col:  3, len: 2 }, { col: 11, len: 2 }] },
  { row: 8, type: 'road',  speed: 3.0,  dir: +1, items: [{ col:  0, len: 2 }, { col:  8, len: 3 }] },
  { row: 9, type: 'road',  speed: 5.0,  dir: -1, items: [{ col:  5, len: 2 }, { col: 13, len: 2 }] },
  { row:10, type: 'road',  speed: 2.5,  dir: +1, items: [{ col:  2, len: 3 }, { col: 12, len: 2 }] },
  { row:11, type: 'road',  speed: 3.5,  dir: -1, items: [{ col:  1, len: 2 }, { col:  9, len: 3 }] },
]

const RIVER_ROWS = new Set(LANES.filter(l => l.type === 'river').map(l => l.row))
const ROAD_ROWS  = new Set(LANES.filter(l => l.type === 'road').map(l => l.row))

const LIVES_INIT        = 3
const COUNTDOWN_STEP_MS = 800
const DEATH_PAUSE_MS    = 800

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFrogger() {
  let api = null

  let lanePositions = []

  let frogCol   = 8
  let frogRow   = HOME_ROW
  let frogOnLog = null

  let homes = [false, false, false, false, false]

  let lives      = LIVES_INIT
  let score      = 0
  let phase      = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  let hopQueued = null

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

  function wrap(v, max) { return ((v % max) + max) % max }

  function initLanes() {
    lanePositions = LANES.map(lane =>
      lane.items.map(item => ({ col: item.col }))
    )
  }

  function startGame() {
    initLanes()
    homes     = [false, false, false, false, false]
    lives     = LIVES_INIT
    score     = 0
    frogCol   = 8
    frogRow   = HOME_ROW
    frogOnLog = null
    hopQueued = null
    phase     = 'countdown'
    countdownN = 3
    phaseTimer = 0
    api.emit('game_start', { game: 'frogger' })
  }

  function respawnFrog() {
    frogCol   = 8
    frogRow   = HOME_ROW
    frogOnLog = null
    hopQueued = null
    phase     = 'playing'
  }

  function itemCoversCol(li, ii, col) {
    const len  = LANES[li].items[ii].len
    const head = lanePositions[li][ii].col
    for (const base of [head, head - COLS, head + COLS]) {
      if (col >= base - 0.6 && col <= base + len - 1 + 0.6) return true
    }
    return false
  }

  function findLog(row, col) {
    const li = LANES.findIndex(l => l.row === row)
    if (li < 0) return null
    for (let ii = 0; ii < lanePositions[li].length; ii++) {
      if (itemCoversCol(li, ii, col)) return { li, ii }
    }
    return null
  }

  function findCar(row, col) {
    const li = LANES.findIndex(l => l.row === row)
    if (li < 0) return null
    const intCol = Math.round(col)
    for (let ii = 0; ii < lanePositions[li].length; ii++) {
      const len  = LANES[li].items[ii].len
      const head = lanePositions[li][ii].col
      for (const base of [head, head - COLS, head + COLS]) {
        // Math.round aligns the collision grid with the render position;
        // Math.floor caused up-to-1-cell offset between visual and hit detection.
        const startC = Math.round(base)
        for (let k = 0; k < len; k++) {
          if ((startC + k + COLS) % COLS === (intCol + COLS) % COLS) return { li, ii }
        }
      }
    }
    return null
  }

  function checkDeath() {
    const fc = Math.round(frogCol)

    if (frogCol < -0.5 || frogCol >= COLS + 0.5) { die('drift'); return true }

    if (RIVER_ROWS.has(frogRow)) {
      if (!findLog(frogRow, frogCol)) { die('water'); return true }
    }

    if (ROAD_ROWS.has(frogRow)) {
      if (findCar(frogRow, frogCol)) { die('car'); return true }
    }

    if (frogRow === GOAL_ROW) {
      const padIdx = PAD_COLS.indexOf(fc)
      if (padIdx < 0 || homes[padIdx]) { die(padIdx >= 0 ? 'pad_taken' : 'water'); return true }
      homes[padIdx] = true
      score++
      api.emit('player_scored', { score, homesFilledCount: homes.filter(Boolean).length })
      if (homes.every(Boolean)) {
        phase = 'win'
        api.emit('scrap_lost', { score })
        return true
      }
      respawnFrog()
      return true
    }

    return false
  }

  function die(reason) {
    lives--
    if (lives <= 0) {
      phase = 'gameover'
      api.emit('scrap_won', { score, reason })
    } else {
      phase      = 'dead'
      phaseTimer = 0
      api.emit('near_miss', { reason, livesLeft: lives })
    }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    const cellW = w / COLS
    const cellH = h / ROWS

    // Background
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Zone backgrounds
    // River zone (rows 1-5): very dark blue-black
    ctx.fillStyle = 'rgba(0,20,50,0.9)'
    ctx.fillRect(0, cellH, w, cellH * 5)

    // Median (row 6) and home row (row 12): dim grey strip
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillRect(0, 6 * cellH, w, cellH)
    ctx.fillRect(0, HOME_ROW * cellH, w, cellH)

    // Goal row (row 0) — dark background
    ctx.fillStyle = 'rgba(0,20,50,0.9)'
    ctx.fillRect(0, 0, w, cellH)

    // Lily pads
    for (let i = 0; i < PAD_COLS.length; i++) {
      const px = PAD_COLS[i] * cellW
      ctx.fillStyle = homes[i] ? '#fff' : 'rgba(255,255,255,0.35)'
      // Round pad shape — just a rect for crispness
      ctx.fillRect(px + 2, 3, cellW - 4, cellH - 5)
    }

    // Lane items (logs and cars)
    for (let li = 0; li < LANES.length; li++) {
      const lane = LANES[li]
      const isRiver = lane.type === 'river'
      ctx.fillStyle = isRiver ? 'rgba(255,255,255,0.45)' : '#fff'

      for (let ii = 0; ii < lanePositions[li].length; ii++) {
        const head    = lanePositions[li][ii].col
        const len     = LANES[li].items[ii].len
        const py      = lane.row * cellH
        const itemW   = len * cellW

        // Draw at base position and one wrap in each direction (canvas clips automatically)
        for (const base of [head, head - COLS, head + COLS]) {
          const bx = base * cellW
          if (isRiver) {
            ctx.fillRect(bx + 1, py + 2, itemW - 2, cellH - 4)
          } else {
            // Car: slightly shorter, brighter
            ctx.fillRect(bx + 1, py + 3, itemW - 2, cellH - 6)
          }
        }
      }
    }

    // Frog
    if (phase !== 'gameover' && phase !== 'win') {
      const fx = frogCol * cellW
      const fy = frogRow * cellH
      const alpha = phase === 'dead' ? 0.3 : 1
      ctx.fillStyle = `rgba(255,255,255,${alpha})`
      ctx.fillRect(fx + 3, fy + 3, cellW - 6, cellH - 6)
    }

    // HUD — lives bottom-left, score bottom-right
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = '11px monospace'
    ctx.textBaseline = 'bottom'
    ctx.textAlign = 'left'
    ctx.fillText('♥ '.repeat(lives).trim(), 4, h - 2)
    ctx.textAlign = 'right'
    ctx.fillText(`${score}`, w - 4, h - 2)

    // Countdown overlay
    if (phase === 'countdown') {
      ctx.fillStyle = '#fff'
      ctx.font = '60px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(countdownN), w / 2, h / 2)
    }

    // Win screen
    if (phase === 'win') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '36px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('YOU WIN', w / 2, h / 2 - 22)
      ctx.font = '14px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to play again', w / 2, h / 2 + 18)
    }

    // Game-over screen
    if (phase === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '32px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('GAME OVER', w / 2, h / 2 - 22)
      ctx.font = '14px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText('space to play again', w / 2, h / 2 + 18)
    }
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'frogger',
      name:          'FROGGER',
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
      if (event.type !== 'keydown') return
      const { key } = event

      if (phase !== 'playing') {
        if (key === ' ' || key === 'Enter') {
          if (phase === 'idle' || phase === 'gameover' || phase === 'win') startGame()
        }
        return
      }

      const map = { ArrowUp:{ dc:0,dr:-1 }, ArrowDown:{ dc:0,dr:1 }, ArrowLeft:{ dc:-1,dr:0 }, ArrowRight:{ dc:1,dr:0 } }
      if (map[key]) hopQueued = map[key]
      if (key === 'Escape') { api.emit('game_quit', { score }); phase = 'gameover' }
    },

    tick(dt) {
      const dtS = dt / 1000

      if (phase === 'countdown') {
        phaseTimer += dt
        while (phaseTimer >= COUNTDOWN_STEP_MS) {
          phaseTimer -= COUNTDOWN_STEP_MS
          countdownN--
          if (countdownN <= 0) { phase = 'playing'; break }
        }
        return
      }

      if (phase === 'dead') {
        phaseTimer += dt
        if (phaseTimer >= DEATH_PAUSE_MS) respawnFrog()
        return
      }

      if (phase === 'playing') {
        // Move lane items
        for (let li = 0; li < LANES.length; li++) {
          const lane = LANES[li]
          const dx   = lane.speed * lane.dir * dtS
          for (let ii = 0; ii < lanePositions[li].length; ii++) {
            lanePositions[li][ii].col = wrap(lanePositions[li][ii].col + dx, COLS)
          }
        }

        // Drift frog with log if on river
        if (RIVER_ROWS.has(frogRow) && frogOnLog) {
          const { li } = frogOnLog
          const lane = LANES[li]
          frogCol = frogCol + lane.speed * lane.dir * dtS
        }

        // Process queued hop
        if (hopQueued) {
          const { dc, dr } = hopQueued
          hopQueued = null

          const newRow = clamp(frogRow + dr, 0, ROWS - 1)
          const newCol = Math.round(frogCol) + dc

          frogRow   = newRow
          frogCol   = newCol
          frogOnLog = null

          if (RIVER_ROWS.has(frogRow)) {
            frogOnLog = findLog(frogRow, frogCol)
          }
        } else if (RIVER_ROWS.has(frogRow)) {
          frogOnLog = findLog(frogRow, frogCol)
        }

        checkDeath()
        return
      }

      // win / gameover — no per-tick logic needed
    },

    render,

    destroy() { api = null },

    // ── Test-only helpers ──────────────────────────────────────────────────
    _getPhase()         { return phase },
    _getScore()         { return score },
    _getLives()         { return lives },
    _getHomes()         { return [...homes] },
    _getFrog()          { return { col: frogCol, row: frogRow } },
    _setFrog(col, row)  { frogCol = col; frogRow = row; frogOnLog = null; hopQueued = null },
    _setHomes(h)        { homes = [...h] },
    _forcePhase(p)      { phase = p },
    _getLanePositions()  { return lanePositions.map(l => l.map(i => ({ ...i }))) },
  }
}
