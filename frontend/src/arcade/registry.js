import { createPong }      from './games/pong'
import { createSnake }     from './games/snake'
import { createBreakout }  from './games/breakout'
import { createInvaders }  from './games/invaders'
import { createTetris }    from './games/tetris'
import { createFrogger }   from './games/frogger'
import { createTron }      from './games/tron'
import { createConnect4 }  from './games/connect4'
import { createTictactoe } from './games/tictactoe'

export const GAME_HELP = {
  pong:      'mouse or ↑↓ paddle · Esc quit · first to 7 · Space restart',
  snake:     '↑↓←→ steer · Space start/restart · Esc quit',
  breakout:  '←→ paddle · mouse↕ = paddle x · Space restart',
  invaders:  '←→ move · Space fire · Esc pause',
  tetris:    '←→ move · ↑ rotate · ↓ soft drop · Space hard drop · Esc pause',
  frogger:   '↑↓←→ hop · Space restart',
  tron:      '↑↓←→ or WASD steer · Esc quit · first to 3 rounds',
  connect4:  '←→ cursor · Space/tap drop · Esc quit',
  tictactoe: '↑↓←→ cursor · Space/tap place · Esc quit',
}

export const GAMES = [
  { id: 'pong',      create: createPong,      help: GAME_HELP.pong      },
  { id: 'snake',     create: createSnake,     help: GAME_HELP.snake     },
  { id: 'breakout',  create: createBreakout,  help: GAME_HELP.breakout  },
  { id: 'invaders',  create: createInvaders,  help: GAME_HELP.invaders  },
  { id: 'tetris',    create: createTetris,    help: GAME_HELP.tetris    },
  { id: 'frogger',   create: createFrogger,   help: GAME_HELP.frogger   },
  { id: 'tron',      create: createTron,      help: GAME_HELP.tron      },
  { id: 'connect4',  create: createConnect4,  help: GAME_HELP.connect4  },
  { id: 'tictactoe', create: createTictactoe, help: GAME_HELP.tictactoe },
]

export function findGameIndex(id) {
  return GAMES.findIndex(g => g.id === id)
}
