import { OFF, DIM, LIT } from '../constants'

// ── Layout ────────────────────────────────────────────────────────────────────
//
//  Row  0 : goal strip — 5 lily pads at cols 1,4,7,10,13; water between
//  Rows 1-5 : river lanes (frog must ride a log)
//  Row  6 : safe median strip
//  Rows 7-11: road lanes (frog must dodge cars)
//  Row 12 : safe home row (frog spawns here)

const COLS      = 16
const ROWS      = 13
const HOME_ROW  = ROWS - 1   // row 12 — frog spawn
const GOAL_ROW  = 0

const PAD_COLS  = [1, 4, 7, 10, 13]  // lily pad columns

// ── Lane definitions ──────────────────────────────────────────────────────────
// { row, type:'river'|'road', speed (dots/sec), dir:+1|-1, items:[{col,len}] }

const LANES = [
  // River (frog must be ON a log; logs are DIM)
  { row: 1, type: 'river', speed: 3.0,  dir: +1, items: [{ col:  0, len: 4 }, { col:  9, len: 3 }] },
  { row: 2, type: 'river', speed: 2.0,  dir: -1, items: [{ col:  1, len: 3 }, { col:  8, len: 4 }, { col: 14, len: 2 }] },
  { row: 3, type: 'river', speed: 3.5,  dir: +1, items: [{ col:  2, len: 3 }, { col: 10, len: 3 }] },
  { row: 4, type: 'river', speed: 2.5,  dir: -1, items: [{ col:  0, len: 5 }, { col: 11, len: 3 }] },
  { row: 5, type: 'river', speed: 1.5,  dir: +1, items: [{ col:  1, len: 2 }, { col:  6, len: 3 }, { col: 12, len: 2 }] },
  // Road (frog must dodge cars; cars are LIT)
  { row: 7, type: 'road',  speed: 4.0,  dir: -1, items: [{ col:  3, len: 2 }, { col: 11, len: 2 }] },
  { row: 8, type: 'road',  speed: 3.0,  dir: +1, items: [{ col:  0, len: 2 }, { col:  8, len: 3 }] },
  { row: 9, type: 'road',  speed: 5.0,  dir: -1, items: [{ col:  5, len: 2 }, { col: 13, len: 2 }] },
  { row:10, type: 'road',  speed: 2.5,  dir: +1, items: [{ col:  2, len: 3 }, { col: 12, len: 2 }] },
  { row:11, type: 'road',  speed: 3.5,  dir: -1, items: [{ col:  1, len: 2 }, { col:  9, len: 3 }] },
]

const RIVER_ROWS = new Set(LANES.filter(l => l.type === 'river').map(l => l.row))
const ROAD_ROWS  = new Set(LANES.filter(l => l.type === 'road').map(l => l.row))

const LIVES_INIT = 3
const COUNTDOWN_STEP_MS = 800
const DEATH_PAUSE_MS    = 800   // pause before respawn

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFrogger() {
  let api = null

  // Item positions (float cols, wrap by COLS)
  let lanePositions = []  // [lane_idx] → [{ col: float }]

  // Frog
  let frogCol  = 8      // float (drifts with log)
  let frogRow  = HOME_ROW
  let frogOnLog = null  // { laneIdx, itemIdx } or null

  // Homes
  let homes = [false, false, false, false, false]

  let lives  = LIVES_INIT
  let score  = 0
  let phase  = 'idle'
  let phaseTimer = 0
  let countdownN = 3

  let hopQueued = null  // { dc, dr } — queued hop

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

  // Does the item at lanePositions[li][ii] cover float column col?
  function itemCoversCol(li, ii, col) {
    const len  = LANES[li].items[ii].len
    const head = lanePositions[li][ii].col

    // Account for wrap-around: check the item at its position AND one wrap away
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
        const startC = Math.floor(base)
        for (let k = 0; k < len; k++) {
          if ((startC + k + COLS) % COLS === (intCol + COLS) % COLS) return { li, ii }
        }
      }
    }
    return null
  }

  function checkDeath() {
    const fc = Math.round(frogCol)

    // Out of bounds (drifted off)
    if (frogCol < -0.5 || frogCol >= COLS + 0.5) { die('drift'); return true }

    if (RIVER_ROWS.has(frogRow)) {
      if (!findLog(frogRow, frogCol)) { die('water'); return true }
    }

    if (ROAD_ROWS.has(frogRow)) {
      if (findCar(frogRow, frogCol)) { die('car'); return true }
    }

    if (frogRow === GOAL_ROW) {
      // Must land on a pad
      const padIdx = PAD_COLS.indexOf(fc)
      if (padIdx < 0 || homes[padIdx]) { die(padIdx >= 0 ? 'pad_taken' : 'water'); return true }
      // Score!
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

  // ── Drawing ────────────────────────────────────────────────────────────────

  function dot(c, r, state) { api.setDot(c, r, state) }

  function drawScene() {
    api.clearGrid()

    // Median (row 6) and home row (row 12): DIM background
    for (let c = 0; c < COLS; c++) dot(c, 6, DIM)
    for (let c = 0; c < COLS; c++) dot(c, HOME_ROW, DIM)

    // Goal row (row 0): pads
    for (let i = 0; i < PAD_COLS.length; i++) dot(PAD_COLS[i], 0, homes[i] ? LIT : DIM)

    // Lives HUD on home row (right side)
    for (let i = 0; i < LIVES_INIT; i++) dot(COLS - 1 - i, HOME_ROW, i < lives ? LIT : DIM)

    // Draw lanes
    for (let li = 0; li < LANES.length; li++) {
      const lane   = LANES[li]
      const dotState = lane.type === 'river' ? DIM : LIT
      for (let ii = 0; ii < lanePositions[li].length; ii++) {
        const head = lanePositions[li][ii].col
        const len  = LANES[li].items[ii].len
        for (let k = 0; k < len; k++) {
          const c = Math.floor(wrap(head + k, COLS))
          dot(c, lane.row, dotState)
        }
      }
    }

    // Frog
    const fc = Math.round(frogCol)
    if (fc >= 0 && fc < COLS && frogRow >= 0 && frogRow < ROWS)
      dot(fc, frogRow, LIT)
  }

  // ── Contract ────────────────────────────────────────────────────────────────

  return {
    meta: {
      id:       'frogger',
      name:     'FROGGER',
      gridSize: { cols: COLS, rows: ROWS },
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
        drawScene()
        return
      }

      if (phase === 'dead') {
        phaseTimer += dt
        drawScene()
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
          const newCol = Math.round(frogCol) + dc  // discretize before hop

          frogRow  = newRow
          frogCol  = newCol
          frogOnLog = null

          // After hop: re-check if frog is on a log
          if (RIVER_ROWS.has(frogRow)) {
            frogOnLog = findLog(frogRow, frogCol)
          }
        } else if (RIVER_ROWS.has(frogRow)) {
          // Re-find log (log may have moved out from under frog)
          frogOnLog = findLog(frogRow, frogCol)
        }

        // Check survival
        if (!checkDeath()) {
          // Emit near_miss when frog is between car lanes (just passed a car gap)
          // (already handled in die() for actual deaths)
        }

        drawScene()
        return
      }

      if (phase === 'win' || phase === 'gameover') {
        drawScene()
        return
      }
    },

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
