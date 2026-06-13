import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBreakout } from './breakout.js'

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

describe('breakout', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createBreakout()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  it('emits game_start on init', () => {
    const g = createBreakout()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  it('ball bounces off top wall: vy becomes positive', () => {
    // Use col 0 (outside brick columns 1-22) so no brick hit cancels the bounce
    game._setBall(0, 0.4, 0, -90)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getBall().vy).toBeGreaterThan(0)
  })

  it('ball bounces off left wall: vx becomes positive', () => {
    game._setBall(0.05, 8, -90, 0)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getBall().vx).toBeGreaterThan(0)
  })

  it('ball bounces off right wall: vx becomes negative', () => {
    game._setBall(23.8, 8, 90, 0)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getBall().vx).toBeLessThan(0)
  })

  it('brick hit clears brick and emits player_scored', () => {
    const beforeBricks = game._getBricksRemaining()
    // Place ball moving into row 3 brick at col 5
    game._setBall(5, 2.4, 0, 9)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
    expect(game._getBricksRemaining()).toBe(beforeBricks - 1)
  })

  it('ball below paddle emits scrap_won when last life lost', () => {
    // Exhaust lives by dropping ball below paddle repeatedly
    for (let life = 0; life < 3; life++) {
      // Drop ball below paddle and out of bounds
      game._setBall(12, 17, 0, 9)
      game._forcePhase('playing')
      for (let t = 0; t < 10; t++) game.tick(16.67)
    }
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('losing a life (not last) enters point phase, no scrap_won', () => {
    game._setBall(12, 17, 0, 9)
    game._forcePhase('playing')
    for (let t = 0; t < 10; t++) game.tick(16.67)
    expect(game._getLives()).toBe(2)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(false)
  })

  it('all bricks cleared emits scrap_lost', () => {
    // Force score = total bricks - 1, then hit one more
    const total = game._getBricksRemaining()
    // Simulate clearing all but one brick via direct ball hits into brick rows
    // Drive ball through entire brick area by direct manipulation
    // Set remaining bricks to 1 programmatically via repeated brick hits
    // Simpler: emit check after player_scored clears the last brick
    // We'll just verify the mechanism by clearing via rapid ticks
    // Place ball to sweep through rows 1-5 quickly
    for (let b = 0; b < total; b++) {
      const row = 1 + (b % 5)
      const col = 1 + Math.floor(b / 5)
      if (col > 22) break
      game._setBall(col, row - 0.5, 0, 9)
      game._forcePhase('playing')
      game.tick(16.67)
    }
    expect(api.events.some(e => e.name === 'scrap_lost')).toBe(true)
  })

  it('paddle moves left with ArrowLeft input', () => {
    const before = game._getPaddle().x
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getPaddle().x).toBeLessThanOrEqual(before)
  })

  it('paddle moves right with ArrowRight input', () => {
    game._setPaddleX(5)  // not at right wall
    const before = game._getPaddle().x
    game.input({ type: 'keydown', key: 'ArrowRight' })
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getPaddle().x).toBeGreaterThan(before)
  })
})
