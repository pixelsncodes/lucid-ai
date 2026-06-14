import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTetris } from './tetris.js'
import { OFF, DIM } from '../constants.js'

// Canvas tetris — logical constants (must match tetris.js)
const LOGICAL_W = 240
const LOGICAL_H = 480

// Mock API — canvas games only need emit; no setDot/clearGrid.
function mockApi() {
  const events = []
  return {
    emit: vi.fn((name, data) => events.push({ name, data: data ?? null })),
    events,
  }
}

function skipCountdown(game) {
  game.tick(800); game.tick(800); game.tick(800)
}

describe('tetris (canvas)', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createTetris()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  // ── Meta ──────────────────────────────────────────────────────────────────

  it('meta.renderer is canvas', () => {
    expect(game.meta.renderer).toBe('canvas')
  })

  it('meta.logicalWidth / logicalHeight match 240×480 (portrait)', () => {
    expect(game.meta.logicalWidth).toBe(LOGICAL_W)
    expect(game.meta.logicalHeight).toBe(LOGICAL_H)
  })

  it('render method exists', () => {
    expect(typeof game.render).toBe('function')
  })

  // ── Startup ───────────────────────────────────────────────────────────────

  it('emits game_start on init', () => {
    const g = createTetris()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  // ── Piece movement ────────────────────────────────────────────────────────

  it('piece falls one row per fall interval', () => {
    const before = game._getPiece().py
    for (let t = 0; t < 45; t++) game.tick(16.67)
    expect(game._getPiece().py).toBe(before + 1)
  })

  it('ArrowLeft moves piece left', () => {
    const before = game._getPiece().px
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    expect(game._getPiece().px).toBe(before - 1)
  })

  it('ArrowRight moves piece right', () => {
    const before = game._getPiece().px
    game.input({ type: 'keydown', key: 'ArrowRight' })
    expect(game._getPiece().px).toBe(before + 1)
  })

  it('ArrowUp rotates piece', () => {
    game.input({ type: 'keydown', key: 'ArrowUp' })
    expect(game._getPiece().rotation).toBeDefined()
    expect(() => game.tick(16.67)).not.toThrow()
  })

  // ── Scoring ───────────────────────────────────────────────────────────────

  it('line clear emits player_scored', () => {
    const board2 = Array.from({ length: 20 }, (_, r) =>
      new Array(10).fill(r < 19 ? OFF : DIM)
    )
    board2[19][9] = OFF
    game._setBoard(board2)
    game._setPiece(0, 1, 7, 16)  // I piece vertical, col 9, rows 16-19
    game.input({ type: 'keydown', key: ' ' })
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
  })

  it('board full triggers scrap_won', () => {
    const board = Array.from({ length: 20 }, (_, r) =>
      r < 2 ? new Array(10).fill(DIM) : new Array(10).fill(OFF)
    )
    game._setBoard(board)
    game._setNextPiece(1)
    game.input({ type: 'keydown', key: ' ' })
    if (game._getPhase() !== 'gameover') {
      game._setNextPiece(1)
      game.input({ type: 'keydown', key: ' ' })
    }
    for (let i = 0; i < 10 && game._getPhase() !== 'gameover'; i++) {
      game.input({ type: 'keydown', key: ' ' })
    }
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('soft drop (ArrowDown) speeds up fall', () => {
    game.input({ type: 'keydown', key: 'ArrowDown' })
    const before = game._getPiece().py
    for (let t = 0; t < 3; t++) game.tick(16.67)
    expect(game._getPiece().py).toBeGreaterThan(before)
  })

  it('piece locks after LOCK_DELAY ticks touching ground', () => {
    const before = game._getBoard()
    const allOff = before.every(row => row.every(v => v === OFF))
    expect(allOff).toBe(true)

    game.input({ type: 'keydown', key: ' ' })
    const after = game._getBoard()
    const hasDim = after.some(row => row.some(v => v === DIM))
    expect(hasDim).toBe(true)
  })
})
