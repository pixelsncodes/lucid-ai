import { useEffect, useRef, useState } from 'react'
import ArcadePanel from './ArcadePanel'
import { GAMES } from './registry'
import { ARCADE_ENTRY, pickLine } from './reactions'
import './ArcadeShell.css'

const GAME_NAMES = {
  connect4:  'Connect 4',
  tictactoe: 'Tic-Tac-Toe',
}
const getGameName = (id) => GAME_NAMES[id] ?? (id.charAt(0).toUpperCase() + id.slice(1))

export default function ArcadeShell({ onExit, onEvent }) {
  const [view, setView] = useState('picker')
  const [selectedGameId, setSelectedGameId] = useState(null)

  const lastEntryRef = useRef(-1)
  const entryLineRef = useRef(null)
  if (entryLineRef.current === null) {
    entryLineRef.current = pickLine(ARCADE_ENTRY, lastEntryRef)
  }

  function selectGame(id) {
    setSelectedGameId(id)
    setView('playing')
  }

  useEffect(() => {
    if (view !== 'picker') return
    function onKey(e) {
      if (e.type !== 'keydown') return
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1
        if (idx < GAMES.length) selectGame(GAMES[idx].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  if (view === 'playing') {
    return (
      <ArcadePanel
        key={selectedGameId}
        initialGameId={selectedGameId}
        enableCycle={false}
        onEscape={onExit}
        onEvent={onEvent}
      />
    )
  }

  return (
    <div className="arcade-shell">
      <p className="arcade-shell__tagline">{entryLineRef.current}</p>
      <div className="arcade-shell__grid">
        {GAMES.map((game, i) => (
          <button
            key={game.id}
            className="arcade-card"
            onClick={() => selectGame(game.id)}
          >
            <span className="arcade-card__num">{i + 1}</span>
            <span className="arcade-card__name">{getGameName(game.id)}</span>
            <span className="arcade-card__help">{game.help}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
