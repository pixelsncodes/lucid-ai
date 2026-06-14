import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createConnect4 } from './connect4.js'

const BOARD_COLS = 7
const BOARD_ROWS = 6
const EMPTY  = 0
const PLAYER = 1
const SCRAP  = 2

function mockApi() {
  const events = []
  return {
    emit: vi.fn((name, data) => events.push({ name, data: data ?? null })),
    events,
  }
}

// Advance past SCRAP's thinking delay (500ms)
function skipThink(game) {
  game.tick(600)
}

// Build a board from a string grid for readability.
// '.' = empty, 'P' = player, 'S' = scrap. Rows top-to-bottom.
function buildBoard(rows) {
  return rows.map(row =>
    row.split('').map(c => c === 'P' ? PLAYER : c === 'S' ? SCRAP : EMPTY)
  )
}

describe('connect4', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createConnect4()
    game.init(api)
    api.events.length = 0
    api.emit.mockClear()
  })

  // ── Meta ──────────────────────────────────────────────────────────────

  it('meta.renderer is canvas', () => {
    expect(game.meta.renderer).toBe('canvas')
  })

  it('meta dimensions are 420×400', () => {
    expect(game.meta.logicalWidth).toBe(420)
    expect(game.meta.logicalHeight).toBe(400)
  })

  it('render method exists', () => {
    expect(typeof game.render).toBe('function')
  })

  // ── Startup ───────────────────────────────────────────────────────────

  it('emits game_start on init', () => {
    const g = createConnect4()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  it('starts in player_turn phase', () => {
    expect(game._getPhase()).toBe('player_turn')
  })

  // ── Turn machine ──────────────────────────────────────────────────────

  it('player drop transitions to scrap_thinking', () => {
    game._forcePlayerDrop(3)
    expect(game._getPhase()).toBe('scrap_thinking')
  })

  it('scrap_thinking → player_turn after 500ms tick', () => {
    game._forcePlayerDrop(3)
    skipThink(game)
    expect(game._getPhase()).toBe('player_turn')
  })

  it('input ignored in scrap_thinking phase', () => {
    game._forcePlayerDrop(3)
    // Still thinking — another drop should not change board
    const boardBefore = game._getBoard()
    game._forcePlayerDrop(3)
    expect(game._getBoard()).toEqual(boardBefore)
  })

  // ── Keyboard cursor ───────────────────────────────────────────────────

  it('ArrowLeft moves cursor left', () => {
    const before = game._getCursor()
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    expect(game._getCursor()).toBe(before - 1)
  })

  it('ArrowRight moves cursor right', () => {
    const before = game._getCursor()
    game.input({ type: 'keydown', key: 'ArrowRight' })
    expect(game._getCursor()).toBe(before + 1)
  })

  it('cursor does not go below 0', () => {
    for (let i = 0; i < 10; i++) game.input({ type: 'keydown', key: 'ArrowLeft' })
    expect(game._getCursor()).toBe(0)
  })

  it('cursor does not exceed BOARD_COLS-1', () => {
    for (let i = 0; i < 10; i++) game.input({ type: 'keydown', key: 'ArrowRight' })
    expect(game._getCursor()).toBe(BOARD_COLS - 1)
  })

  it('Space drops in current cursor column', () => {
    game.input({ type: 'keydown', key: 'ArrowLeft' })   // cursor at 2
    game.input({ type: 'keydown', key: 'ArrowLeft' })   // cursor at 1
    game.input({ type: 'keydown', key: ' ' })
    const board = game._getBoard()
    const col = game._getCursor() + 1   // cursor moved to 1
    // Bottom row of col 1 should have PLAYER piece
    expect(board[BOARD_ROWS - 1][1]).toBe(PLAYER)
  })

  // ── Tap input ─────────────────────────────────────────────────────────

  it('tap event drops in the tapped column', () => {
    // CELL_W = 60; tap at x=90 → col 1
    game.input({ type: 'tap', x: 90, y: 200 })
    const board = game._getBoard()
    expect(board[BOARD_ROWS - 1][1]).toBe(PLAYER)
  })

  it('tap ignored when not player_turn', () => {
    game._forcePlayerDrop(3)   // now scrap_thinking
    const boardBefore = game._getBoard()
    game.input({ type: 'tap', x: 90, y: 200 })
    expect(game._getBoard()).toEqual(boardBefore)
  })

  // ── Win / draw ────────────────────────────────────────────────────────

  it('four in a row for player emits scrap_lost', () => {
    // Build board: player has 3 in a row at bottom, drop 4th
    const b = buildBoard([
      '.......',
      '.......',
      '.......',
      '.......',
      '.......',
      'PPP....',
    ])
    game._setBoard(b)
    game._forcePlayerDrop(3)   // col 3 → 4 in a row
    expect(api.events.some(e => e.name === 'scrap_lost')).toBe(true)
    expect(game._getPhase()).toBe('over')
    expect(game._getWinner()).toBe('player')
  })

  it('SCRAP four in a row emits scrap_won', () => {
    // Board: SCRAP has 3 in a row at bottom; player piece elsewhere
    const b = buildBoard([
      '.......',
      '.......',
      '.......',
      '.......',
      'P......',
      '.SSS...',
    ])
    game._setBoard(b)
    // Player drops somewhere neutral, then SCRAP completes 4
    game._forcePlayerDrop(5)   // player drops col 5 (safe)
    // Wait for SCRAP to pick col 4 (completing .SSS.)
    skipThink(game)
    // SCRAP should have won
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
    expect(game._getPhase()).toBe('over')
  })

  it('full board with no winner emits draw', () => {
    // A 6×7 board with no 4-in-a-row (verified: pairs alternate, diagonals break).
    // Last empty cell is [5][6]; player drops there to fill the board.
    // Pattern: pair-alternating PP SS PP SS PP SS _ (rows shift phase each row).
    const P = PLAYER, S = SCRAP, _ = EMPTY
    const b = [
      [P, P, S, S, P, P, S],
      [S, S, P, P, S, S, P],
      [P, P, S, S, P, P, S],
      [S, S, P, P, S, S, P],
      [P, P, S, S, P, P, S],
      [S, S, P, P, S, S, _],  // col 6 empty
    ]
    game._setBoard(b)
    game._forcePlayerDrop(6)
    expect(api.events.some(e => e.name === 'draw')).toBe(true)
    expect(game._getPhase()).toBe('over')
    expect(game._getWinner()).toBe('draw')
  })

  // ── AI behavior ───────────────────────────────────────────────────────

  it('SCRAP blocks an obvious player 3-in-a-row threat', () => {
    // Player has 3 in a row at bottom; SCRAP must block col 3
    const b = buildBoard([
      '.......',
      '.......',
      '.......',
      '.......',
      'S......',
      'PPP....',
    ])
    game._setBoard(b)
    game._forcePlayerDrop(4)    // player drops in col 4 (safe square)
    skipThink(game)
    // After SCRAP moves, col 3 bottom row should be SCRAP
    const board = game._getBoard()
    expect(board[BOARD_ROWS - 1][3]).toBe(SCRAP)
  })

  it('SCRAP takes an immediate win when available', () => {
    // SCRAP has 3 in a row; SCRAP should take col 3 for the win
    const b = buildBoard([
      '.......',
      '.......',
      '.......',
      '.......',
      'P......',
      '.SSS...',
    ])
    game._setBoard(b)
    game._forcePlayerDrop(5)
    skipThink(game)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  // ── near_miss ─────────────────────────────────────────────────────────

  it('near_miss emitted when player blocks SCRAP three-in-a-row', () => {
    // SCRAP has 3 consecutive; player must drop to block
    const b = buildBoard([
      '.......',
      '.......',
      '.......',
      '.......',
      'P......',
      '....SSS',
    ])
    game._setBoard(b)
    // Player drops in col 3 (blocking the 4th)
    game._forcePlayerDrop(3)
    expect(api.events.some(e => e.name === 'near_miss')).toBe(true)
  })

  // ── Esc / quit ────────────────────────────────────────────────────────

  it('Escape during play emits game_quit', () => {
    game.input({ type: 'keydown', key: 'Escape' })
    expect(api.events.some(e => e.name === 'game_quit')).toBe(true)
    expect(game._getPhase()).toBe('over')
  })

  it('Escape on over screen restarts game', () => {
    game.input({ type: 'keydown', key: 'Escape' })   // quit → over
    api.emit.mockClear()
    game.input({ type: 'keydown', key: 'Escape' })   // restart
    expect(api.events.some(e => e.name === 'game_start')).toBe(true)
  })
})
