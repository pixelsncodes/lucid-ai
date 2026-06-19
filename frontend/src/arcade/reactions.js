export const GAME_CLASS = {
  pong:      'rival',
  tron:      'rival',
  connect4:  'rival',
  tictactoe: 'rival',
  breakout:  'house',
  invaders:  'house',
  frogger:   'house',
  snake:     'survival',
  tetris:    'survival',
}

export const REACTIONS = {
  near_miss: {
    rival: [
      'Close. Emphasis on close.',
      'That almost counted. Almost.',
      'Your reflexes are statistically mediocre.',
      'Proximity is not points.',
      'Inches. Meaningless inches.',
    ],
    house: [
      'The board flinched. You did not capitalize.',
      'Nearly. The house remembers.',
      'Close calls are the house\'s specialty.',
      'You grazed the danger. It noticed.',
      'Almost is not a score.',
    ],
  },
  player_scored: {
    rival: [
      'Point to you. Savor it.',
      'Lucky frame.',
      'Even a stopped clock.',
      'Noted. Adjust made.',
      'You scored. I logged it.',
    ],
    house: [
      'One down. More incoming.',
      'Progress. Temporary.',
      'The board yields. Grudgingly.',
      'You cleared that. The next one is worse.',
      'Point acknowledged. Don\'t celebrate.',
    ],
    survival: [
      'Line cleared. Entropy continues.',
      'You bought yourself seconds.',
      'Gain noted. Stack disagrees.',
      'One less problem. Twelve more incoming.',
      'Progress. Briefly.',
    ],
  },
  scrap_scored: {
    rival: [
      'Point: me.',
      'Calculated.',
      'Your defenses are decorative.',
      'That one was inevitable.',
      'Logged. Advantage: me.',
    ],
  },
  scrap_won: {
    rival: [
      'Calculated. As usual.',
      'Predictable trajectory. Every time.',
      'I had this from frame one.',
      'Game over. As projected.',
      'Not surprised. You shouldn\'t be either.',
    ],
    house: [
      'The board claims another.',
      'The house wins. It always does.',
      'Entropy favored the obstacles today.',
      'You were outnumbered by geometry.',
      'The board had your number. Several times.',
    ],
    survival: [
      'The stack always wins. Gravity: 1, you: 0.',
      'You topped out. Physics is indifferent.',
      'The pieces did not cooperate. They never do.',
      'Topped out. Expected.',
      'Survival mode: failed.',
    ],
  },
  scrap_lost: {
    rival: [
      '...Lucky input. Won\'t happen twice.',
      'Acknowledged. Statistical anomaly.',
      'You won. I\'m already adjusting.',
      'This changes nothing long-term.',
      'Enjoy it. I\'m logging this for later.',
    ],
    house: [
      'Cleared. Don\'t get comfortable.',
      'The board lets you pass. Once.',
      'You made it through. The board is not impressed.',
      'Victory noted. The house has infinite patience.',
      'Cleared. The obstacles are recalibrating.',
    ],
  },
  draw: {
    rival: [
      'A draw. Disappointing for us both.',
      'Neither won. Both lost dignity.',
      'Stalemate. I expected more from myself.',
      'A tie is a loss with extra steps.',
      'No winner. Just shared mediocrity.',
    ],
  },
}

// Per-game overrides; only populated where a specific flavor is warranted.
export const GAME_SPECIALS = {
  tron: {
    scrap_scored: [
      'Your trail is a map of mistakes.',
      'The grid remembers every wrong turn you made.',
      'Boxed in. Mathematically speaking.',
    ],
  },
  tictactoe: {
    draw: [
      'Three in a row: neither of us. Classic.',
      'Grid solved. Winner: neither. Typical.',
      'A draw at tic-tac-toe. Set the bar lower.',
    ],
  },
}

export function reactionPool(event, gameId) {
  const special = GAME_SPECIALS[gameId]?.[event]
  if (special && special.length > 0) return special

  const cls = GAME_CLASS[gameId]
  const pool = REACTIONS[event]?.[cls]
  if (pool && pool.length > 0) return pool

  return null
}

export const ARCADE_PAUSE = [
  'Tired of losing already?',
  'Quitting while you\'re behind?',
  'The game will still be here when you grow a spine.',
  'Needed a break from the humiliation?',
  'Running away won\'t save your score.',
  'Bold strategy. Pausing.',
]

export const ARCADE_ENTRY = [
  'Back to lose again?',
  'The pixels missed you.',
  'Your high score is not coming back.',
  'Step right up.',
  'Ready to embarrass yourself?',
  'Game on.',
]

export function pickLine(pool, lastRef) {
  const candidates = pool.filter((_, i) => i !== lastRef.current)
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  lastRef.current = pool.indexOf(pick)
  return pick
}
