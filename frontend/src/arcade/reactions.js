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
