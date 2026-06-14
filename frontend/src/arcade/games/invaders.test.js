import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInvaders } from './invaders.js'

// Canvas invaders — logical constants (must match invaders.js)
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

describe('invaders (canvas)', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createInvaders()
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
    const g = createInvaders()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  // ── Player ────────────────────────────────────────────────────────────────

  it('player moves right on ArrowRight', () => {
    const before = game._getPlayer().x
    game.input({ type: 'keydown', key: 'ArrowRight' })
    game.tick(16.67)
    game.input({ type: 'keyup', key: 'ArrowRight' })
    expect(game._getPlayer().x).toBeGreaterThan(before)
  })

  it('player fires bullet on Space', () => {
    game.input({ type: 'keydown', key: ' ' })
    expect(game._getBullet().active).toBe(true)
  })

  it('player cannot fire while bullet is active', () => {
    game.input({ type: 'keydown', key: ' ' })
    const y1 = game._getBullet().y
    game.tick(16.67)
    const y2 = game._getBullet().y
    game.input({ type: 'keydown', key: ' ' })
    expect(game._getBullet().y).toBe(y2)
    expect(y2).toBeLessThan(y1)
  })

  // ── Scoring / events ──────────────────────────────────────────────────────

  it('bullet killing an invader emits player_scored', () => {
    game._setBullet(2, 2.1, true)
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
    expect(game._getKills()).toBe(1)
  })

  it('all invaders killed emits scrap_lost', () => {
    game._killAllBut(0, 0)
    game._setBullet(2, 2.1, true)
    game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_lost')).toBe(true)
  })

  it('bomb hitting player emits scrap_won when last life', () => {
    for (let i = 0; i < 2; i++) {
      game._spawnBomb(game._getPlayer().x, 13)
      for (let t = 0; t < 20; t++) game.tick(16.67)
      game._forcePhase('playing')
    }
    api.events.length = 0
    game._spawnBomb(game._getPlayer().x, 13)
    for (let t = 0; t < 20; t++) game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('invaders reaching player row emits scrap_won', () => {
    game._setArmyY(10)
    for (let t = 0; t < 60; t++) game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('mouse_y events are ignored without error', () => {
    expect(() => game.input({ type: 'mouse_y', row: 5 })).not.toThrow()
  })
})
