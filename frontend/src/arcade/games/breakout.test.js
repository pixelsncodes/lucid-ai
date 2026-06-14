import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBreakout } from './breakout.js'

// Canvas breakout — logical constants (must match breakout.js)
const LOGICAL_W = 480
const LOGICAL_H = 320

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

describe('breakout (canvas)', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createBreakout()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  // ── Meta ──────────────────────────────────────────────────────────────────

  it('meta.renderer is canvas', () => {
    expect(game.meta.renderer).toBe('canvas')
  })

  it('meta.logicalWidth / logicalHeight match 480×320', () => {
    expect(game.meta.logicalWidth).toBe(LOGICAL_W)
    expect(game.meta.logicalHeight).toBe(LOGICAL_H)
  })

  it('render method exists', () => {
    expect(typeof game.render).toBe('function')
  })

  // ── Startup ───────────────────────────────────────────────────────────────

  it('emits game_start on init', () => {
    const g = createBreakout()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  // ── Ball physics ──────────────────────────────────────────────────────────

  it('ball bounces off top wall: vy becomes positive', () => {
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

  // ── Scoring ───────────────────────────────────────────────────────────────

  it('brick hit clears brick and emits player_scored', () => {
    const beforeBricks = game._getBricksRemaining()
    game._setBall(5, 2.4, 0, 9)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
    expect(game._getBricksRemaining()).toBe(beforeBricks - 1)
  })

  // ── Win / loss ────────────────────────────────────────────────────────────

  it('ball below paddle emits scrap_won when last life lost', () => {
    for (let life = 0; life < 3; life++) {
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
    const total = game._getBricksRemaining()
    for (let b = 0; b < total; b++) {
      const row = 1 + (b % 5)
      const col = Math.floor(b / 5)
      if (col > 23) break
      // col+0.25 keeps the ball's x within ±0.7 of bc=col only, avoiding wall
      // bounces (col=0) and adjacent-column spill that would waste an iteration.
      game._setBall(col + 0.25, row - 0.5, 0, 9)
      game._forcePhase('playing')
      game.tick(16.67)
    }
    expect(api.events.some(e => e.name === 'scrap_lost')).toBe(true)
  })

  // ── Input ─────────────────────────────────────────────────────────────────

  it('paddle moves left with ArrowLeft input', () => {
    const before = game._getPaddle().x
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getPaddle().x).toBeLessThanOrEqual(before)
  })

  it('paddle moves right with ArrowRight input', () => {
    game._setPaddleX(5)
    const before = game._getPaddle().x
    game.input({ type: 'keydown', key: 'ArrowRight' })
    game._forcePhase('playing')
    game.tick(16.67)
    expect(game._getPaddle().x).toBeGreaterThan(before)
  })
})
