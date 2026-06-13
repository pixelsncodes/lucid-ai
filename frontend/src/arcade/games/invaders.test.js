import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInvaders } from './invaders.js'

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

describe('invaders', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createInvaders()
    game.init(api)
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  it('emits game_start on init', () => {
    const g = createInvaders()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

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
    game.tick(16.67) // bullet moves up
    const y2 = game._getBullet().y
    // Try firing again — bullet position should be y2, not reset to player row
    game.input({ type: 'keydown', key: ' ' })
    expect(game._getBullet().y).toBe(y2)
    expect(y2).toBeLessThan(y1)  // bullet moved upward
  })

  it('bullet killing an invader emits player_scored', () => {
    // invader [0][0] is at col=INV_START_C=2, row=INV_START_R=2 initially
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
    // Drain lives to 1 via direct manipulation, then bomb the player
    for (let i = 0; i < 2; i++) {
      game._spawnBomb(game._getPlayer().x, 13)
      for (let t = 0; t < 20; t++) game.tick(16.67)
      game._forcePhase('playing') // resume after 'dead' flash
    }
    api.events.length = 0
    // Final bomb on player
    game._spawnBomb(game._getPlayer().x, 13)
    for (let t = 0; t < 20; t++) game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('invaders reaching player row emits scrap_won', () => {
    // lowestInvRow = INV_START_R(2) + (INV_ROWS-1)(2)*2 + armyY = 2+4+armyY
    // DANGER_ROW = PLAYER_ROW = 14. Need 2+4+armyY >= 14 → armyY >= 8.
    game._setArmyY(10)  // lowestInvRow = 16 >= 14
    // Tick past one army step interval (0.9s = 54 ticks at 16.67ms)
    for (let t = 0; t < 60; t++) game.tick(16.67)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('mouse_y events are ignored without error', () => {
    expect(() => game.input({ type: 'mouse_y', row: 5 })).not.toThrow()
  })
})
