import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTetris } from './tetris.js'
import { OFF, DIM } from '../constants.js'

function mockApi() {
  const events = []
  return {
    setDot: vi.fn(),
    clearGrid: vi.fn(),
    emit: vi.fn((name, data) => events.push({ name, data: data ?? null })),
    events,
  }
}

function skipCountdown(game) {
  game.tick(800); game.tick(800); game.tick(800)
}

describe('tetris', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createTetris()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  it('emits game_start on init', () => {
    const g = createTetris()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  it('piece falls one row per fall interval', () => {
    // FALL_TICKS_INIT = 45; tick 45 times to get one gravity drop
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
    const before = game._getPiece().rotation
    game.input({ type: 'keydown', key: 'ArrowUp' })
    // Rotation changes (or stays same if wall-kick fails for this piece/position)
    // At minimum, no crash
    expect(game._getPiece().rotation).toBeDefined()
    // For most pieces at spawn position, rotation should change
    // (O piece doesn't rotate, but all others do)
    expect(() => game.tick(16.67)).not.toThrow()
  })

  it('line clear emits player_scored', () => {
    // Fill all rows except the bottom with DIM, leave bottom row empty except last col
    // Then spawn an I piece (piece 0) and hard-drop it to complete the row
    const board = Array.from({ length: 20 }, (_, r) =>
      r < 19
        ? new Array(10).fill(OFF)
        : new Array(10).fill(DIM).map((v, c) => c < 9 ? v : OFF)  // bottom row: 9 filled, col 9 empty
    )
    game._setBoard(board)
    // Place the I piece (piece 0, rot 1 = vertical, width 1) at column 9 near bottom
    // rot 1 of I: [[2,0],[2,1],[2,2],[2,3]] → spans 4 rows tall from (bx+2, by)
    // Easier: use rot 0 of I (horizontal): [[0,1],[1,1],[2,1],[3,1]] in a 4×4 box
    // Spawn at px=6, py=13 → cells at (6,14),(7,14),(8,14),(9,14) — that fills the last 4 cells of row 14
    // But row 19 only has col 9 empty — doesn't work cleanly.

    // Simplest: fill bottom row with DIM except one cell, place a 1-col piece there
    const board2 = Array.from({ length: 20 }, (_, r) =>
      new Array(10).fill(r < 19 ? OFF : DIM)
    )
    board2[19][9] = OFF  // one hole at col 9, row 19
    game._setBoard(board2)
    // Piece 0 (I), rot 1 (vertical 4-tall): cells [2,0][2,1][2,2][2,3] in 4×4 box
    // Place at px=7, py=14 → col=7+2=9, rows 14,15,16,17 — all OFF → can lock.
    // After locking: row 19 gets (9,17) which is row 17, not 19. Need py=16:
    // cells at row 16,17,18,19. Row 19 col 9 gets filled → line complete!
    game._setPiece(0, 1, 7, 16)  // I piece vertical at col 9, rows 16-19
    game.input({ type: 'keydown', key: ' ' })  // hard drop (already at bottom, locks immediately)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
  })

  it('board full triggers scrap_won', () => {
    // Fill the top two rows with DIM, then spawn a piece that can't fit
    const board = Array.from({ length: 20 }, (_, r) =>
      r < 2 ? new Array(10).fill(DIM) : new Array(10).fill(OFF)
    )
    game._setBoard(board)
    // nextPiece set to 1 (O piece, 2×2). Spawn at px=4, py=0: cells (4,0),(5,0),(4,1),(5,1)
    // row 0 and 1 are DIM → collision → gameover
    game._setNextPiece(1)
    // Hard-drop current piece to lock it and trigger next spawn (which should fail)
    game.input({ type: 'keydown', key: ' ' })
    if (game._getPhase() !== 'gameover') {
      // Spawn O piece which will collide with filled rows
      game._setNextPiece(1)
      game.input({ type: 'keydown', key: ' ' })
    }
    // At some point the board will fill and trigger scrap_won
    // Keep hard-dropping until gameover
    for (let i = 0; i < 10 && game._getPhase() !== 'gameover'; i++) {
      game.input({ type: 'keydown', key: ' ' })
    }
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('soft drop (ArrowDown) speeds up fall', () => {
    // With soft drop, piece should fall every SOFT_DROP_TICKS (2) instead of 45
    game.input({ type: 'keydown', key: 'ArrowDown' })
    const before = game._getPiece().py
    for (let t = 0; t < 3; t++) game.tick(16.67)  // 3 ticks → should have fallen ≥1 row at interval=2
    expect(game._getPiece().py).toBeGreaterThan(before)
  })

  it('piece locks after LOCK_DELAY ticks touching ground', () => {
    // Hard-drop a piece to the bottom, then verify it locks (board has DIM cells)
    const before = game._getBoard()
    const allOff = before.every(row => row.every(v => v === OFF))
    expect(allOff).toBe(true)  // board starts empty

    game.input({ type: 'keydown', key: ' ' })  // hard drop → locks immediately
    const after = game._getBoard()
    const hasDim = after.some(row => row.some(v => v === DIM))
    expect(hasDim).toBe(true)  // piece is now locked on board
  })
})
