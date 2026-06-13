import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSnake } from './snake.js'

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

// One snake step = TICK_INTERVAL_INIT (8) game-ticks
function oneStep(game, steps = 1) {
  for (let s = 0; s < steps; s++)
    for (let t = 0; t < 8; t++) game.tick(16.67)
}

describe('snake', () => {
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

  it('emits game_start on init', () => {
    const g = createSnake()
    const a = mockApi()
    g.init(a)
    expect(a.events.some(e => e.name === 'game_start')).toBe(true)
  })

  it('180-degree reversal rejected: right→left does not kill snake', () => {
    // Snake starts facing right. Attempting to reverse to left should be silently dropped.
    game.input({ type: 'keydown', key: 'ArrowLeft' })
    oneStep(game)
    // Snake moved right without dying — no scrap_won
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(false)
  })

  it('eating food emits player_scored with score=1', () => {
    // Place food one step ahead of the snake head (which starts facing right)
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
    // Place a 5-cell snake in a U shape where the head is heading into its own body.
    // Layout (facing right, head at col 3):
    //   row 5: [5,5][4,5][3,5] ← body (cols 3-5)
    //   row 6: [5,6][5,5] — but we build via _setSnake directly:
    //   snake = [(3,5),(3,6),(4,6),(5,6),(5,5)] facing right
    //   Next step right: head → (4,5) which IS in the body at index 2 of the original array…
    //   Actually let's trace: body is [(3,5),(3,6),(4,6),(5,6),(5,5)].
    //   Head (3,5) moves right → (4,5). Is (4,5) in snake? No.
    //   Need: head = (4,5) already positioned, facing right → (5,5) which IS in snake[4].
    game._setSnake(
      [{ x:4,y:5 },{ x:3,y:5 },{ x:3,y:6 },{ x:4,y:6 },{ x:5,y:6 },{ x:5,y:5 }],
      { x:1, y:0 },
    )
    game._setFood(0, 13)  // food far away so it won't interfere
    oneStep(game)  // head moves right to (5,5) which is snake[5] → death
    expect(api.events.some(e => e.name === 'scrap_won')).toBe(true)
  })

  it('wall collision emits scrap_won', () => {
    // Snake starts at x=12 facing right; right wall is at x=24 (COLS).
    // 12 steps forward (x=24 >= COLS) = collision.
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
