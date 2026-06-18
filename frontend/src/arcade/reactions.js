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
