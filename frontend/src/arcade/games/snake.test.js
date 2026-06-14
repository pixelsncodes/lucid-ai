import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSnake } from './snake.js'

// Canvas snake — logical constants (must match snake.js)
const LOGICAL_W = 480
const LOGICAL_H = 280

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

// One snake step = TICK_INTERVAL_INIT (8) game-ticks
function oneStep(game, steps = 1) {
  for (let s = 0; s < steps; s++)
    for (let t = 0; t < 8; t++) game.tick(16.67)
}

describe('snake (canvas)', () => {
  let api, game

  beforeEach(() => {
    api  = mockApi()
    game = createSnake()
    vi.spyOn(Math, 'random').mockReturnValue(0.99)  // food far from snake center
    game.init(api)
    vi.restoreAllMocks()
    skipCountdown(game)
    api.events.length = 0
    api.emit.mockClear()
  })

  // ── Meta ──────────────────────────────────────────────────────────────────

  it('meta.renderer is canvas', () => {
    expect(game.meta.renderer).toBe('canvas')
  })

  it('meta.logicalWidth / logicalHeight match 480×280', () => {
    expect(game.meta.logicalWidth).toBe(LOGICAL_W)
    expect(game.meta.logicalHeight).toBe(LOGICAL_H)
  })

  it('render method exists', () => {
    expect(typeof game.render).toBe('function')
  })

  // ── Startup ───────────────────────────────────────────────────────────────

  it('emits game_start on init', () => {
    const g = createSnake()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  // ── Game logic ────────────────────────────────────────────────────────────

  it('180-degree reversal rejected: right→left does not kill snake', () => {
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    oneStep(game)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(false)
  })

  it('eating food emits player_scored with score=1', () => {
    const head = game._getSnakeHead()
    game._setFood(head.x + 1, head.y)
    oneStep(game)
    expect(api.events.some(e => e.name === 'player_scored')).toBe(true)
    expect(game._getScore()).toBe(1)
  })

  it('eating food grows the snake by 1', () => {
    const lenBefore = game._getSnakeLength()
    const head = game._getSnakeHead()
    game._setFood(head.x + 1, head.y)
    oneStep(game)
    expect(game._getSnakeLength()).toBe(lenBefore + 1)
  })

  it('self collision emits scrap_won', () => {
    game._setSnake(
      [{ x:4,y:5 },{ x:3,y:5 },{ x:3,y:6 },{ x:4,y:6 },{ x:5,y:6 },{ x:5,y:5 }],
      { x:1, y:0 },
    )
    game._setFood(0, 13)
    oneStep(game)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('wall collision emits scrap_won', () => {
    oneStep(game, 12)
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('game_quit emitted on Escape during play', () => {
    game.input({ type: 'keydown', key: 'Escape' })
    expect(api.events.some(e => e.name === 'game_quit')).toBe(true)
  })

  it('keyup events are ignored without error', () => {
    expect(() => game.input({ type: 'keyup', key: 'ArrowUp' })).not.toThrow()
    expect(api.events.length).toBe(0)
  })

  it('mouse_y events are ignored without error', () => {
    expect(() => game.input({ type: 'mouse_y', row: 5 })).not.toThrow()
    expect(api.events.length).toBe(0)
  })
})
