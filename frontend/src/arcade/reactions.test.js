import { describe, it, expect } from 'vitest'
import { reactionPool, GAME_CLASS, REACTIONS, GAME_SPECIALS } from './reactions.js'

describe('reactionPool', () => {
  // The inversion: scrap_won means different things per class
  it('scrap_won returns distinct pools for rival, house, and survival games', () => {
    const rivalPool    = reactionPool('scrap_won', 'pong')
    const housePool    = reactionPool('scrap_won', 'frogger')
    const survivalPool = reactionPool('scrap_won', 'tetris')

    expect(rivalPool).not.toBeNull()
    expect(housePool).not.toBeNull()
    expect(survivalPool).not.toBeNull()
    expect(rivalPool).not.toEqual(housePool)
    expect(housePool).not.toEqual(survivalPool)
    expect(rivalPool).not.toEqual(survivalPool)
  })

  // Every game id routes scrap_won to its class pool
  it.each([
    ['pong',      'rival'],
    ['tron',      'rival'],
    ['connect4',  'rival'],
    ['tictactoe', 'rival'],
    ['breakout',  'house'],
    ['invaders',  'house'],
    ['frogger',   'house'],
    ['snake',     'survival'],
    ['tetris',    'survival'],
  ])('%s scrap_won routes to %s class pool', (gameId, cls) => {
    const pool = reactionPool('scrap_won', gameId)
    expect(pool).toBe(REACTIONS.scrap_won[cls])
  })

  // draw is rival-only
  it('draw returns a pool for connect4 and tictactoe', () => {
    expect(reactionPool('draw', 'connect4')).not.toBeNull()
    expect(reactionPool('draw', 'tictactoe')).not.toBeNull()
  })

  it('draw returns null for non-rival games', () => {
    expect(reactionPool('draw', 'breakout')).toBeNull()
    expect(reactionPool('draw', 'invaders')).toBeNull()
    expect(reactionPool('draw', 'frogger')).toBeNull()
    expect(reactionPool('draw', 'snake')).toBeNull()
    expect(reactionPool('draw', 'tetris')).toBeNull()
  })

  // scrap_lost has no survival pool
  it('scrap_lost returns null for survival games', () => {
    expect(reactionPool('scrap_lost', 'snake')).toBeNull()
    expect(reactionPool('scrap_lost', 'tetris')).toBeNull()
  })

  it('scrap_lost returns a pool for rival and house games', () => {
    expect(reactionPool('scrap_lost', 'pong')).not.toBeNull()
    expect(reactionPool('scrap_lost', 'connect4')).not.toBeNull()
    expect(reactionPool('scrap_lost', 'breakout')).not.toBeNull()
    expect(reactionPool('scrap_lost', 'frogger')).not.toBeNull()
  })

  // Unknown inputs return null
  it('returns null for an unknown event', () => {
    expect(reactionPool('unknown_event', 'pong')).toBeNull()
  })

  it('returns null for an unknown gameId', () => {
    expect(reactionPool('scrap_won', 'unknown_game')).toBeNull()
  })

  it('returns null for both unknown event and unknown gameId', () => {
    expect(reactionPool('ghost_event', 'ghost_game')).toBeNull()
  })

  // GAME_SPECIALS overrides the class pool
  it('tron scrap_scored returns the GAME_SPECIALS override, not the class pool', () => {
    const pool = reactionPool('scrap_scored', 'tron')
    expect(pool).toBe(GAME_SPECIALS.tron.scrap_scored)
    expect(pool).not.toBe(REACTIONS.scrap_scored.rival)
  })

  it('tictactoe draw returns the GAME_SPECIALS override, not the class pool', () => {
    const pool = reactionPool('draw', 'tictactoe')
    expect(pool).toBe(GAME_SPECIALS.tictactoe.draw)
    expect(pool).not.toBe(REACTIONS.draw.rival)
  })

  it('connect4 draw (no special) falls through to the class pool', () => {
    const pool = reactionPool('draw', 'connect4')
    expect(pool).toBe(REACTIONS.draw.rival)
  })

  // Function is pure — same inputs, same output
  it('is deterministic (pure function)', () => {
    expect(reactionPool('scrap_won', 'pong')).toBe(reactionPool('scrap_won', 'pong'))
  })
})
