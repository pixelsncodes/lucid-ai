// ── Tic-Tac-Toe ──────────────────────────────────────────────────────────────
// 3×3, big X/O glyphs. Turn-based phase machine reusing Game 8's scaffold.
// AI is deliberately IMPERFECT: takes an immediate win, blocks an immediate
// loss, then plays center → corners → edges with NO fork lookahead so a
// player who knows the fork strategy can always win.

const LOGICAL_W = 360
const LOGICAL_H = 360

const GRID = 3
const CELL = LOGICAL_W / GRID   // 120

const SCRAP_THINK_MS = 500

const EMPTY  = 0
const PLAYER = 1   // X
const SCRAP  = 2   // O

// ── Lines to check ────────────────────────────────────────────────────────────

const LINES = [
  // Rows
  [0,1,2], [3,4,5], [6,7,8],
  // Cols
  [0,3,6], [1,4,7], [2,5,8],
  // Diagonals
  [0,4,8], [2,4,6],
]

export function createTictactoe() {
  let api = null

  // Board indexed 0..8, row-major (0=top-left, 2=top-right, 6=bot-left, 8=bot-right)
  let board      = new Array(9).fill(EMPTY)
  let phase      = 'player_turn'   // player_turn|scrap_thinking|over
  let winner     = null            // null|'player'|'scrap'|'draw'
  let thinkTimer = 0
  let cursor     = 4               // keyboard cursor (center cell by default)
  let pendingIdx = -1              // cell SCRAP chose during thinking delay

  // ── Board helpers ────────────────────────────────────────────────────────

  function checkWinner(b) {
    for (const [a, c, e] of LINES) {
      if (b[a] !== EMPTY && b[a] === b[c] && b[c] === b[e]) {
        return b[a] === PLAYER ? 'player' : 'scrap'
      }
    }
    if (b.every(c => c !== EMPTY)) return 'draw'
    return null
  }

  function emptyCells(b) {
    return b.map((v, i) => v === EMPTY ? i : -1).filter(i => i >= 0)
  }

  // Returns an index that wins immediately for `who`, or -1.
  function findWinMove(b, who) {
    for (const idx of emptyCells(b)) {
      const nb = b.slice(); nb[idx] = who
      if (checkWinner(nb) === (who === PLAYER ? 'player' : 'scrap')) return idx
    }
    return -1
  }

  // ── AI (deliberately imperfect) ──────────────────────────────────────────

  const CORNER_PREFS = [0, 2, 6, 8]
  const SIDE_PREFS   = [1, 3, 5, 7]

  function aiChooseCell() {
    // 1. Take immediate win
    const win = findWinMove(board, SCRAP)
    if (win !== -1) return win

    // 2. Block immediate player win
    const block = findWinMove(board, PLAYER)
    if (block !== -1) return block

    // 3. Center → corner → edge (no fork lookahead — deliberately beatable)
    if (board[4] === EMPTY) return 4
    const corner = CORNER_PREFS.find(i => board[i] === EMPTY)
    if (corner !== undefined) return corner
    const side   = SIDE_PREFS.find(i => board[i] === EMPTY)
    if (side !== undefined) return side

    return emptyCells(board)[0] ?? -1
  }

  // ── near_miss detection ──────────────────────────────────────────────────

  function hadThreeInLine(b, who) {
    const foe = who === PLAYER ? SCRAP : PLAYER
    // Someone just placed and now we have 3 who's in a row (win) or we blocked foe's win
    // near_miss: either side just blocked the other's imminent win
    return LINES.some(([a, c, e]) => {
      const cells = [b[a], b[c], b[e]]
      const myCnt  = cells.filter(x => x === who).length
      const foeCnt = cells.filter(x => x === foe).length
      // "blocking move": foe had 2 in this line and we placed the blocker
      return myCnt === 1 && foeCnt === 2
    })
  }

  // ── Game lifecycle ───────────────────────────────────────────────────────

  function startGame() {
    board      = new Array(9).fill(EMPTY)
    phase      = 'player_turn'
    winner     = null
    thinkTimer = 0
    cursor     = 4
    pendingIdx = -1
    api.emit('game_start', { game: 'tictactoe' })
  }

  function resolveOutcome(w) {
    if (w === 'player') {
      phase  = 'over'; winner = 'player'
      api.emit('scrap_lost', { winner: 'player' })
    } else if (w === 'scrap') {
      phase  = 'over'; winner = 'scrap'
      api.emit('scrap_won', { winner: 'scrap' })
    } else if (w === 'draw') {
      phase  = 'over'; winner = 'draw'
      api.emit('draw', { game: 'tictactoe' })
    }
  }

  function playerPlace(idx) {
    if (phase !== 'player_turn') return
    if (idx < 0 || idx > 8) return
    if (board[idx] !== EMPTY) return

    const before = board.slice()
    board[idx] = PLAYER

    const w = checkWinner(board)
    if (w) { resolveOutcome(w); return }

    if (hadThreeInLine(board, PLAYER)) {
      api.emit('near_miss', { mover: 'player' })
    }

    pendingIdx = aiChooseCell()
    thinkTimer = 0
    phase      = 'scrap_thinking'
  }

  function scrapPlace() {
    const idx = pendingIdx
    pendingIdx = -1
    if (idx === -1) { phase = 'player_turn'; return }

    board[idx] = SCRAP
    const w = checkWinner(board)
    if (w) { resolveOutcome(w); return }

    if (hadThreeInLine(board, SCRAP)) {
      api.emit('near_miss', { mover: 'scrap' })
    }

    phase = 'player_turn'
  }

  // ── Cell from tap / grid coords ──────────────────────────────────────────

  function idxFromTap(x, y) {
    const col = Math.floor(x / CELL)
    const row = Math.floor(y / CELL)
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return -1
    return row * GRID + col
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  function render(ctx, { w, h }) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    // Grid lines
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    for (let i = 1; i < GRID; i++) {
      ctx.beginPath()
      ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * CELL); ctx.lineTo(w, i * CELL)
      ctx.stroke()
    }

    // Keyboard cursor highlight
    if (phase === 'player_turn') {
      const cr = Math.floor(cursor / GRID), cc = cursor % GRID
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(cc * CELL + 2, cr * CELL + 2, CELL - 4, CELL - 4)
    }

    // Pieces
    const pad = 20
    for (let i = 0; i < 9; i++) {
      const r = Math.floor(i / GRID), c = i % GRID
      const x = c * CELL, y = r * CELL

      if (board[i] === PLAYER) {
        // X — two diagonal strokes
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 8
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(x + pad, y + pad)
        ctx.lineTo(x + CELL - pad, y + CELL - pad)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x + CELL - pad, y + pad)
        ctx.lineTo(x + pad, y + CELL - pad)
        ctx.stroke()
      } else if (board[i] === SCRAP) {
        // O — circle
        ctx.strokeStyle = 'rgba(200,200,200,0.85)'
        ctx.lineWidth = 8
        ctx.lineCap = 'butt'
        ctx.beginPath()
        ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - pad, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

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

    // Thinking hint
    if (phase === 'scrap_thinking') {
      ctx.fillStyle = 'rgba(255,255,255,0.45)'
      ctx.font = '14px monospace'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText('SCRAP thinking…', w - 6, h - 6)
    }
  }

  // ── Contract ─────────────────────────────────────────────────────────────

  return {
    meta: {
      id:            'tictactoe',
      name:          'TIC-TAC-TOE',
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
        const idx = idxFromTap(event.x, event.y)
        if (idx >= 0) playerPlace(idx)
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

      if (key === 'ArrowLeft')  { cursor = cursor % GRID > 0            ? cursor - 1 : cursor; return }
      if (key === 'ArrowRight') { cursor = cursor % GRID < GRID - 1     ? cursor + 1 : cursor; return }
      if (key === 'ArrowUp')    { cursor = cursor >= GRID                ? cursor - GRID : cursor; return }
      if (key === 'ArrowDown')  { cursor = cursor < GRID * (GRID - 1)   ? cursor + GRID : cursor; return }
      if (key === ' ' || key === 'Enter') { playerPlace(cursor); return }
    },

    tick(dt) {
      if (phase !== 'scrap_thinking') return
      thinkTimer += dt
      if (thinkTimer >= SCRAP_THINK_MS) scrapPlace()
    },

    render,

    destroy() { api = null },

    // ── Test helpers ─────────────────────────────────────────────────────
    _getPhase()         { return phase },
    _getWinner()        { return winner },
    _getBoard()         { return board.slice() },
    _setBoard(b)        { board = b.slice() },
    _getCursor()        { return cursor },
    _forcePlayerPlace(i){ playerPlace(i) },
    _forcePhase(p)      { phase = p },
    _skipThink()        { if (phase === 'scrap_thinking') thinkTimer = SCRAP_THINK_MS + 1 },
  }
}
