// ── Connect Four ─────────────────────────────────────────────────────────────
// 7×6 board. Turn-based phase machine inside the fixed-timestep contract.
// Tap a column or arrow-cursor + space to drop. SCRAP uses depth-4 minimax.

const BOARD_COLS = 7
const BOARD_ROWS = 6

const LOGICAL_W   = 420
const LOGICAL_H   = 400

// One cell = 60px wide; header row = 40px, board rows = 60px each
const CELL_W      = LOGICAL_W / BOARD_COLS   // 60
const HEADER_H    = 40
const CELL_H      = (LOGICAL_H - HEADER_H) / BOARD_ROWS  // 60

const SCRAP_THINK_MS = 500   // deliberate thinking pause

// ── Minimax depth — depth 4 is strong but beatable ───────────────────────────
const AI_DEPTH = 4

const EMPTY  = 0
const PLAYER = 1
const SCRAP  = 2

export function createConnect4() {
  let api = null

  // board[row][col]: EMPTY | PLAYER | SCRAP.  row 0 = top.
  let board      = []
  let phase      = 'player_turn'   // player_turn|scrap_thinking|over
  let winner     = null            // null|'player'|'scrap'|'draw'
  let thinkTimer = 0
  let cursor     = Math.floor(BOARD_COLS / 2)   // column cursor for keyboard
  let dropCol    = -1   // column SCRAP chose during thinking delay

  // ── Board helpers ────────────────────────────────────────────────────────

  function makeBoard() {
    return Array.from({ length: BOARD_ROWS }, () => new Array(BOARD_COLS).fill(EMPTY))
  }

  function boardCopy(b) {
    return b.map(r => r.slice())
  }

  function lowestEmpty(b, col) {
    for (let row = BOARD_ROWS - 1; row >= 0; row--) {
      if (b[row][col] === EMPTY) return row
    }
    return -1   // column full
  }

  function drop(b, col, who) {
    const row = lowestEmpty(b, col)
    if (row === -1) return null
    const nb = boardCopy(b)
    nb[row][col] = who
    return nb
  }

  function availableCols(b) {
    const cols = []
    for (let c = 0; c < BOARD_COLS; c++) {
      if (b[0][c] === EMPTY) cols.push(c)
    }
    return cols
  }

  function isFull(b) {
    return availableCols(b).length === 0
  }

  function checkLine(b, r, c, dr, dc, who) {
    for (let i = 0; i < 4; i++) {
      const nr = r + dr * i
      const nc = c + dc * i
      if (nr < 0 || nr >= BOARD_ROWS || nc < 0 || nc >= BOARD_COLS) return false
      if (b[nr][nc] !== who) return false
    }
    return true
  }

  function findWinner(b) {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        for (const who of [PLAYER, SCRAP]) {
          if (
            checkLine(b, r, c, 0, 1, who) ||
            checkLine(b, r, c, 1, 0, who) ||
            checkLine(b, r, c, 1, 1, who) ||
            checkLine(b, r, c, 1, -1, who)
          ) return who
        }
      }
    }
    return null
  }

  // Count a window of 4 for SCRAP heuristic scoring.
  function windowScore(cells, who) {
    const foe   = who === SCRAP ? PLAYER : SCRAP
    const mine  = cells.filter(c => c === who).length
    const empty = cells.filter(c => c === EMPTY).length
    const theirs = cells.filter(c => c === foe).length
    if (theirs > 0) return 0
    if (mine === 4) return 100
    if (mine === 3 && empty === 1) return 5
    if (mine === 2 && empty === 2) return 2
    return 0
  }

  function evaluateBoard(b) {
    let score = 0
    // Center column preference
    const centerCol = Math.floor(BOARD_COLS / 2)
    for (let r = 0; r < BOARD_ROWS; r++) {
      if (b[r][centerCol] === SCRAP)  score += 3
      if (b[r][centerCol] === PLAYER) score -= 3
    }
    // Horizontal
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c <= BOARD_COLS - 4; c++) {
        const window = [b[r][c], b[r][c+1], b[r][c+2], b[r][c+3]]
        score += windowScore(window, SCRAP) - windowScore(window, PLAYER)
      }
    }
    // Vertical
    for (let c = 0; c < BOARD_COLS; c++) {
      for (let r = 0; r <= BOARD_ROWS - 4; r++) {
        const window = [b[r][c], b[r+1][c], b[r+2][c], b[r+3][c]]
        score += windowScore(window, SCRAP) - windowScore(window, PLAYER)
      }
    }
    // Diagonal /
    for (let r = 3; r < BOARD_ROWS; r++) {
      for (let c = 0; c <= BOARD_COLS - 4; c++) {
        const window = [b[r][c], b[r-1][c+1], b[r-2][c+2], b[r-3][c+3]]
        score += windowScore(window, SCRAP) - windowScore(window, PLAYER)
      }
    }
    // Diagonal \
    for (let r = 0; r <= BOARD_ROWS - 4; r++) {
      for (let c = 0; c <= BOARD_COLS - 4; c++) {
        const window = [b[r][c], b[r+1][c+1], b[r+2][c+2], b[r+3][c+3]]
        score += windowScore(window, SCRAP) - windowScore(window, PLAYER)
      }
    }
    return score
  }

  function minimax(b, depth, alpha, beta, maximizing) {
    const w = findWinner(b)
    if (w === SCRAP)  return  1000 + depth
    if (w === PLAYER) return -1000 - depth
    if (isFull(b) || depth === 0) return evaluateBoard(b)

    const cols = availableCols(b)
    if (maximizing) {
      let best = -Infinity
      for (const c of cols) {
        const nb = drop(b, c, SCRAP)
        if (!nb) continue
        best = Math.max(best, minimax(nb, depth - 1, alpha, beta, false))
        alpha = Math.max(alpha, best)
        if (beta <= alpha) break
      }
      return best
    } else {
      let best = Infinity
      for (const c of cols) {
        const nb = drop(b, c, PLAYER)
        if (!nb) continue
        best = Math.min(best, minimax(nb, depth - 1, alpha, beta, true))
        beta = Math.min(beta, best)
        if (beta <= alpha) break
      }
      return best
    }
  }

  function aiBestCol() {
    const cols = availableCols(board)
    if (cols.length === 0) return -1
    let best = -Infinity, bestCol = cols[0]
    for (const c of cols) {
      const nb = drop(board, c, SCRAP)
      if (!nb) continue
      const score = minimax(nb, AI_DEPTH - 1, -Infinity, Infinity, false)
      if (score > best) { best = score; bestCol = c }
    }
    return bestCol
  }

  // ── near_miss detection ──────────────────────────────────────────────────

  function countConsecutive(b, who, count) {
    // Returns true if `who` has `count` in a row with at least one open slot to complete 4.
    const foe = who === SCRAP ? PLAYER : SCRAP
    const dirs = [[0,1],[1,0],[1,1],[1,-1]]
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        for (const [dr, dc] of dirs) {
          let mine = 0, empty = 0
          for (let i = 0; i < 4; i++) {
            const nr = r + dr * i, nc = c + dc * i
            if (nr < 0 || nr >= BOARD_ROWS || nc < 0 || nc >= BOARD_COLS) { mine = 0; break }
            const cell = b[nr][nc]
            if (cell === who)  mine++
            else if (cell === EMPTY) empty++
            else { mine = 0; break }
          }
          if (mine === count && empty === 4 - count) return true
        }
      }
    }
    return false
  }

  function checkNearMiss(beforeBoard, afterBoard, who) {
    // near_miss: blocking a 3-in-a-row, or creating a double threat (two ways to win)
    const foe = who === SCRAP ? PLAYER : SCRAP
    // Was foe threatening 3-in-a-row before and we placed into it?
    const foeWasThreating = countConsecutive(beforeBoard, foe, 3)
    // Do we now have two separate 3-in-a-rows (double threat)?
    const weHaveDouble = countDoubleThreats(afterBoard, who)
    return foeWasThreating || weHaveDouble
  }

  function countDoubleThreats(b, who) {
    // Count distinct columns where dropping wins immediately
    const cols = availableCols(b)
    let winCount = 0
    for (const c of cols) {
      const nb = drop(b, c, who)
      if (nb && findWinner(nb) === who) winCount++
    }
    return winCount >= 2
  }

  // ── Game lifecycle ───────────────────────────────────────────────────────

  function startGame() {
    board      = makeBoard()
    phase      = 'player_turn'
    winner     = null
    thinkTimer = 0
    cursor     = Math.floor(BOARD_COLS / 2)
    dropCol    = -1
    api.emit('game_start', { game: 'connect4' })
  }

  function playerDrop(col) {
    if (phase !== 'player_turn') return
    if (col < 0 || col >= BOARD_COLS) return
    if (lowestEmpty(board, col) === -1) return   // full column

    const beforeBoard = boardCopy(board)
    const nb = drop(board, col, PLAYER)
    if (!nb) return
    board = nb

    const w = findWinner(board)
    if (w === PLAYER) {
      phase  = 'over'
      winner = 'player'
      api.emit('scrap_lost', { winner: 'player' })
      return
    }
    if (isFull(board)) {
      phase  = 'over'
      winner = 'draw'
      api.emit('draw', { game: 'connect4' })
      return
    }

    if (checkNearMiss(beforeBoard, board, PLAYER)) {
      api.emit('near_miss', { mover: 'player' })
    }

    // Start thinking phase
    dropCol    = aiBestCol()
    thinkTimer = 0
    phase      = 'scrap_thinking'
  }

  function scrapDrop() {
    if (dropCol === -1) return
    const col = dropCol
    dropCol = -1

    const beforeBoard = boardCopy(board)
    const nb = drop(board, col, SCRAP)
    if (!nb) { phase = 'player_turn'; return }
    board = nb

    const w = findWinner(board)
    if (w === SCRAP) {
      phase  = 'over'
      winner = 'scrap'
      api.emit('scrap_won', { winner: 'scrap' })
      return
    }
    if (isFull(board)) {
      phase  = 'over'
      winner = 'draw'
      api.emit('draw', { game: 'connect4' })
      return
    }

    if (checkNearMiss(beforeBoard, board, SCRAP)) {
      api.emit('near_miss', { mover: 'scrap' })
    }

    phase = 'player_turn'
  }

  // ── Column from tap ──────────────────────────────────────────────────────

  function colFromTap(x) {
    return Math.floor(x / CELL_W)
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Cursor arrow in header
    if (phase === 'player_turn') {
      const cx = cursor * CELL_W + CELL_W / 2
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.moveTo(cx,            8)
      ctx.lineTo(cx - 10,       28)
      ctx.lineTo(cx + 10,       28)
      ctx.closePath()
      ctx.fill()
    }

    // Board grid and pieces
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const x  = c * CELL_W
        const y  = HEADER_H + r * CELL_H
        const cx = x + CELL_W / 2
        const cy = y + CELL_H / 2
        const rad = Math.min(CELL_W, CELL_H) / 2 - 5

        // Cell background
        ctx.fillStyle = 'rgba(255,255,255,0.08)'
        ctx.fillRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4)

        const cell = board[r][c]
        if (cell === PLAYER) {
          // Player: solid white disc
          ctx.beginPath()
          ctx.arc(cx, cy, rad, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
        } else if (cell === SCRAP) {
          // SCRAP: gray outlined ring (gray as second tone only)
          ctx.beginPath()
          ctx.arc(cx, cy, rad, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(180,180,180,0.85)'
          ctx.lineWidth = 3
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(cx, cy, rad - 6, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(140,140,140,0.5)'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (let c = 1; c < BOARD_COLS; c++) {
      ctx.beginPath()
      ctx.moveTo(c * CELL_W, HEADER_H)
      ctx.lineTo(c * CELL_W, h)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(0, HEADER_H)
    ctx.lineTo(w, HEADER_H)
    ctx.stroke()

    // Over overlay
    if (phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#fff'
      ctx.font = '42px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const msg = winner === 'player' ? 'YOU WIN'
                : winner === 'scrap'  ? 'SCRAP WINS'
                :                       'DRAW'
      ctx.fillText(msg, w / 2, h / 2 - 24)
      ctx.font = '16px monospace'
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillText('Esc to restart', w / 2, h / 2 + 20)
    }

    // Thinking indicator
    if (phase === 'scrap_thinking') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.font = '14px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('SCRAP thinking…', w - 8, 8)
    }
  }

  // ── Contract ─────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'connect4',
      name:          'CONNECT FOUR',
      renderer:      'canvas',
      logicalWidth:  LOGICAL_W,
      logicalHeight: LOGICAL_H,
    },

    init(_api) {
      api = _api
      startGame()
    },

    input(event) {
      if (event.type === 'tap') {
        if (phase !== 'player_turn') return
        const col = colFromTap(event.x)
        if (col >= 0 && col < BOARD_COLS) playerDrop(col)
        return
      }
      if (event.type !== 'keydown') return
      const { key } = event

      if (key === 'Escape') {
        if (phase !== 'over') {
          phase  = 'over'
          winner = null
          api.emit('game_quit', {})
        } else {
          startGame()
        }
        return
      }
      if (phase !== 'player_turn') return

      if (key === 'ArrowLeft')  { cursor = Math.max(0, cursor - 1); return }
      if (key === 'ArrowRight') { cursor = Math.min(BOARD_COLS - 1, cursor + 1); return }
      if (key === ' ' || key === 'Enter') { playerDrop(cursor); return }
    },

    tick(dt) {
      if (phase !== 'scrap_thinking') return
      thinkTimer += dt
      if (thinkTimer >= SCRAP_THINK_MS) scrapDrop()
    },

    render,

    destroy() { api = null },

    // ── Test helpers ─────────────────────────────────────────────────────
    _getPhase()          { return phase },
    _getWinner()         { return winner },
    _getBoard()          { return board.map(r => r.slice()) },
    _setBoard(b)         { board = b.map(r => r.slice()) },
    _getCursor()         { return cursor },
    _forcePlayerDrop(c)  { playerDrop(c) },
    _forcePhase(p)       { phase = p },
    _skipThink()         { if (phase === 'scrap_thinking') { thinkTimer = SCRAP_THINK_MS + 1; } },
    _findWinner()        { return findWinner(board) },
    _lowestEmpty(col)    { return lowestEmpty(board, col) },
  }
}
