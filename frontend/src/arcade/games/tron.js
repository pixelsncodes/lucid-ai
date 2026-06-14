// ── Light Cycles / Tron ───────────────────────────────────────────────────────
// Two trails on a discrete grid; crash into any wall or trail → lose the round.
// Reuses Snake's grid-stepping model.

const COLS = 30
const ROWS = 30
const LOGICAL_W = 360
const LOGICAL_H = 360

const WIN_ROUNDS    = 3
const STEP_INTERVAL = 6     // game-ticks per grid step → 10 steps/sec @ 60fps
const ROUND_END_MS  = 1500  // pause between rounds
const COUNTDOWN_MS  = 900   // ms per countdown digit

// AI tuning — raise AGGRESSION (0–1) for harder opponent
const AGGRESSION = 0.4

const DIRS = [
  { x:  0, y: -1 },
  { x:  0, y:  1 },
  { x: -1, y:  0 },
  { x:  1, y:  0 },
]

export function createTron() {
  let api = null

  let playerTrail = new Set()   // "x,y" strings
  let scrapTrail  = new Set()
  let playerHead  = { x: 5,  y: 15 }
  let scrapHead   = { x: 24, y: 14 }
  let playerDir   = { x: 1,  y: 0 }
  let scrapDir    = { x: -1, y: 0 }
  let nextPlayerDir = { x: 1, y: 0 }

  let playerScore = 0
  let scrapScore  = 0

  let phase      = 'idle'   // idle|countdown|playing|round_end|over
  let phaseTimer = 0
  let countdownN = 3
  let stepAccum  = 0
  let overMsg    = ''

  // near_miss cooldown — avoid spamming the event
  let nearMissCooldown = 0

  // ── Helpers ─────────────────────────────────────────────────────────────

  function cell(x, y) { return `${x},${y}` }

  function blocked(x, y, ownTrail, foeTrail) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return true
    if (ownTrail.has(cell(x, y))) return true
    if (foeTrail.has(cell(x, y))) return true
    return false
  }

  function safeOptions(head, dir, own, foe) {
    return DIRS.filter(d => {
      if (d.x === -dir.x && d.y === -dir.y) return false   // no 180°
      return !blocked(head.x + d.x, head.y + d.y, own, foe)
    })
  }

  // Bounded BFS to estimate free space ahead.
  function openSpace(head, dir, own, foe, depth) {
    const visited = new Set([cell(head.x, head.y)])
    let frontier = []
    const step1 = { x: head.x + dir.x, y: head.y + dir.y }
    if (!blocked(step1.x, step1.y, own, foe)) frontier.push(step1)
    let count = 0
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = []
      for (const p of frontier) {
        const k = cell(p.x, p.y)
        if (visited.has(k)) continue
        visited.add(k)
        count++
        for (const dd of DIRS) {
          const nx = p.x + dd.x
          const ny = p.y + dd.y
          if (!blocked(nx, ny, own, foe)) next.push({ x: nx, y: ny })
        }
      }
      frontier = next
    }
    return count
  }

  // ── AI ──────────────────────────────────────────────────────────────────

  function aiChooseDir() {
    const safe = safeOptions(scrapHead, scrapDir, scrapTrail, playerTrail)
    if (safe.length === 0) return scrapDir   // will die anyway

    // 20% random pick → keeps AI beatable
    if (Math.random() < 0.2) return safe[Math.floor(Math.random() * safe.length)]

    let best = null, bestScore = -Infinity
    for (const d of safe) {
      const nHead  = { x: scrapHead.x + d.x, y: scrapHead.y + d.y }
      const newOwn = new Set(scrapTrail)
      newOwn.add(cell(nHead.x, nHead.y))

      const space = openSpace(nHead, d, newOwn, playerTrail, 4)

      // Mild aggression: reward moving toward player to cut space
      const dxP = playerHead.x - nHead.x
      const dyP = playerHead.y - nHead.y
      const aggr = (d.x * Math.sign(dxP) + d.y * Math.sign(dyP)) * AGGRESSION

      const score = space + aggr * 3
      if (score > bestScore) { bestScore = score; best = d }
    }
    return best ?? safe[0]
  }

  // ── Round lifecycle ──────────────────────────────────────────────────────

  function initRound() {
    playerTrail   = new Set()
    scrapTrail    = new Set()
    playerHead    = { x: 5,  y: 15 }
    scrapHead     = { x: 24, y: 14 }
    playerDir     = { x: 1,  y: 0 }
    nextPlayerDir = { x: 1,  y: 0 }
    scrapDir      = { x: -1, y: 0 }
    stepAccum     = 0
    nearMissCooldown = 0
    playerTrail.add(cell(playerHead.x, playerHead.y))
    scrapTrail.add(cell(scrapHead.x, scrapHead.y))
  }

  function startRound() {
    initRound()
    phase      = 'countdown'
    countdownN = 3
    phaseTimer = 0
  }

  function startGame() {
    playerScore = 0
    scrapScore  = 0
    startRound()
    api.emit('game_start', { game: 'tron' })
  }

  function endRound(playerWon) {
    if (playerWon) {
      playerScore++
      api.emit('player_scored', { playerScore, scrapScore })
      if (playerScore >= WIN_ROUNDS) {
        phase  = 'over'
        overMsg = 'YOU WIN'
        api.emit('scrap_lost', { playerScore, scrapScore })
      } else {
        phase = 'round_end'; phaseTimer = 0
      }
    } else {
      scrapScore++
      api.emit('scrap_scored', { playerScore, scrapScore })
      if (scrapScore >= WIN_ROUNDS) {
        phase   = 'over'
        overMsg = 'SCRAP WINS'
        api.emit('scrap_won', { playerScore, scrapScore })
      } else {
        phase = 'round_end'; phaseTimer = 0
      }
    }
  }

  // ── Step ────────────────────────────────────────────────────────────────

  function step() {
    // Commit queued player direction (no 180°)
    if (!(nextPlayerDir.x === -playerDir.x && nextPlayerDir.y === -playerDir.y)) {
      playerDir = { ...nextPlayerDir }
    }

    const pNext = { x: playerHead.x + playerDir.x, y: playerHead.y + playerDir.y }
    const sNext = { x: scrapHead.x  + scrapDir.x,  y: scrapHead.y  + scrapDir.y  }

    const pDied = blocked(pNext.x, pNext.y, playerTrail, scrapTrail)
    const sDied = blocked(sNext.x, sNext.y, scrapTrail, playerTrail)

    if (pDied && sDied) { endRound(false); return }   // tie → SCRAP scores
    if (pDied)           { endRound(false); return }
    if (sDied)           { endRound(true);  return }

    // Both survive — advance
    playerHead = pNext
    playerTrail.add(cell(pNext.x, pNext.y))
    scrapHead  = sNext
    scrapTrail.add(cell(sNext.x, sNext.y))

    // near_miss: SCRAP trail or border immediately perpendicular to player
    if (nearMissCooldown <= 0) {
      const lx = playerHead.x + playerDir.y,  ly = playerHead.y - playerDir.x
      const rx = playerHead.x - playerDir.y,  ry = playerHead.y + playerDir.x
      const lClose = (lx < 0 || lx >= COLS || ly < 0 || ly >= ROWS || scrapTrail.has(cell(lx, ly)))
      const rClose = (rx < 0 || rx >= COLS || ry < 0 || ry >= ROWS || scrapTrail.has(cell(rx, ry)))
      if (lClose || rClose) {
        api.emit('near_miss', { type: 'close_call' })
        nearMissCooldown = 8   // ~8 steps cooldown
      }
    } else {
      nearMissCooldown--
    }

    // Pre-compute SCRAP's next direction
    scrapDir = aiChooseDir()
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    const cw  = w / COLS
    const ch  = h / ROWS
    const pad = 1

    // Player trail — solid white
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    for (const k of playerTrail) {
      const [gx, gy] = k.split(',').map(Number)
      ctx.fillRect(gx * cw + pad, gy * ch + pad, cw - pad * 2, ch - pad * 2)
    }

    // SCRAP trail — dimmer
    ctx.fillStyle = 'rgba(255,255,255,0.38)'
    for (const k of scrapTrail) {
      const [gx, gy] = k.split(',').map(Number)
      ctx.fillRect(gx * cw + pad, gy * ch + pad, cw - pad * 2, ch - pad * 2)
    }

    if (phase === 'playing' || phase === 'countdown') {
      // Player head — bright filled square
      ctx.fillStyle = '#fff'
      ctx.fillRect(
        playerHead.x * cw + pad - 1, playerHead.y * ch + pad - 1,
        cw - pad * 2 + 2, ch - pad * 2 + 2,
      )

      // SCRAP head — outlined square (distinct but dimmer)
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(
        scrapHead.x * cw + pad + 1, scrapHead.y * ch + pad + 1,
        cw - pad * 2 - 2, ch - pad * 2 - 2,
      )
    }

    // Score strip top-left
    ctx.fillStyle = '#fff'
    ctx.font = '13px monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`YOU ${playerScore}   SCRAP ${scrapScore}`, 6, 4)

    if (phase === 'countdown') {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '72px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(countdownN), w / 2, h / 2)
    }

    if (phase === 'round_end') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '28px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('NEXT ROUND', w / 2, h / 2)
    }

    if (phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '44px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(overMsg, w / 2, h / 2 - 28)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillText('space to restart', w / 2, h / 2 + 20)
    }
  }

  // ── Contract ─────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'tron',
      name:          'LIGHT CYCLES',
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

      if (key === 'Escape') {
        if (phase === 'playing' || phase === 'countdown' || phase === 'round_end') {
          phase   = 'over'
          overMsg = 'QUIT'
          api.emit('game_quit', { playerScore, scrapScore })
        }
        return
      }
      if ((key === ' ' || key === 'Enter') && phase === 'over') {
        startGame()
        return
      }

      const map = {
        ArrowUp:    { x:  0, y: -1 },
        ArrowDown:  { x:  0, y:  1 },
        ArrowLeft:  { x: -1, y:  0 },
        ArrowRight: { x:  1, y:  0 },
        w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
        s: { x: 0, y:  1 }, S: { x: 0, y:  1 },
        a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
        d: { x:  1, y: 0 }, D: { x:  1, y: 0 },
      }
      const d = map[key]
      if (d) nextPlayerDir = d
    },

    tick(dt) {
      if (phase === 'countdown') {
        phaseTimer += dt
        while (phaseTimer >= COUNTDOWN_MS && phase === 'countdown') {
          phaseTimer -= COUNTDOWN_MS
          countdownN--
          if (countdownN <= 0) { phase = 'playing'; break }
        }
        return
      }

      if (phase === 'playing') {
        stepAccum++
        if (stepAccum >= STEP_INTERVAL) { stepAccum = 0; step() }
        return
      }

      if (phase === 'round_end') {
        phaseTimer += dt
        if (phaseTimer >= ROUND_END_MS) startRound()
        return
      }
    },

    render,

    destroy() { api = null },

    // ── Test helpers ────────────────────────────────────────────────────────
    _getPhase()         { return phase },
    _getScores()        { return { playerScore, scrapScore } },
    _getPlayerHead()    { return { ...playerHead } },
    _getScrapHead()     { return { ...scrapHead } },
    _getPlayerDir()     { return { ...playerDir } },
    _getScrapDir()      { return { ...scrapDir } },
    _getPlayerTrail()   { return new Set(playerTrail) },
    _getScrapTrail()    { return new Set(scrapTrail) },
    _setPhase(p)        { phase = p },
    _setPlayerHead(h)   { playerHead = { ...h } },
    _setScrapHead(h)    { scrapHead = { ...h } },
    _setPlayerDir(d)    { playerDir = { ...d }; nextPlayerDir = { ...d } },
    _setScrapDir(d)     { scrapDir = { ...d } },
    _setTrails(pt, st)  { playerTrail = new Set(pt); scrapTrail = new Set(st) },
    _stepOnce()         { step() },
  }
}
