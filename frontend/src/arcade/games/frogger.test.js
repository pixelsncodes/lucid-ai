import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFrogger } from './frogger.js'

// Canvas frogger — logical constants (must match frogger.js)
const LOGICAL_W = 320
const LOGICAL_H = 260

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

describe('frogger (canvas)', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createFrogger()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  // ── Meta ──────────────────────────────────────────────────────────────────

  it('meta.renderer is canvas', () => {
    expect(game.meta.renderer).toBe('canvas')
  })

  it('meta.logicalWidth / logicalHeight match 320×260', () => {
    expect(game.meta.logicalWidth).toBe(LOGICAL_W)
    expect(game.meta.logicalHeight).toBe(LOGICAL_H)
  })

  it('render method exists', () => {
    expect(typeof game.render).toBe('function')
  })

  // ── Startup ───────────────────────────────────────────────────────────────

  it('emits game_start on init', () => {
    const g = createFrogger()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  // ── Frog movement ─────────────────────────────────────────────────────────

  it('frog hops up on ArrowUp', () => {
    const before = game._getFrog().row
    game.input({ type: 'keydown', key: 'ArrowUp' })
    game.tick(16.67)
    expect(game._getFrog().row).toBe(before - 1)
  })

  it('frog hops down on ArrowDown', () => {
    game._setFrog(8, 6)
    const before = game._getFrog().row
    game.input({ type: 'keydown', key: 'ArrowDown' })
    game.tick(16.67)
    expect(game._getFrog().row).toBe(before + 1)
  })

  // ── Death / events ────────────────────────────────────────────────────────

  it('frog on road hit by car emits scrap_won or near_miss', () => {
    game._setFrog(3, 7)
    game._forcePhase('playing')
    for (let t = 0; t < 200; t++) {
      game.tick(16.67)
      if (api.events.some(e => e.name === 'scrap_won' || e.name === 'near_miss')) break
    }
    expect(api.events.some(e => e.name === 'scrap_won' || e.name === 'near_miss')).toBe(true)
  })

  it('frog in river without log dies', () => {
    game._setFrog(5, 1)
    game._forcePhase('playing')
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'near_miss' || e.name === 'scrap_won')).toBe(true)
  })

  it('frog reaching a lily pad emits player_scored', () => {
    game._setFrog(1, 1)
    game._forcePhase('playing')
    game.input({ type: 'keydown', key: 'ArrowUp' })
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
  })

  it('all 5 lily pads filled emits scrap_lost', () => {
    game._setHomes([true, true, true, true, false])
    game._setFrog(13, 1)
    game._forcePhase('playing')
    game.input({ type: 'keydown', key: 'ArrowUp' })
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_lost')).toBe(true)
  })

  it('game_quit emitted on Escape', () => {
    game.input({ type: 'keydown', key: 'Escape' })
    expect(api.events.some(e => e.name === 'game_quit')).toBe(true)
  })

  it('mouse_y events are ignored without error', () => {
    expect(() => game.input({ type: 'mouse_y', row: 5 })).not.toThrow()
    expect(api.events.length).toBe(0)
  })
})
