import { useCallback, useEffect, useRef, useState } from 'react'
import ArcadePanel from './ArcadePanel'
import { GAMES } from './registry'
import { ARCADE_ENTRY, ARCADE_PAUSE, pickLine } from './reactions'
import './ArcadeShell.css'

const GAME_NAMES = {
  connect4:  'Connect 4',
  tictactoe: 'Tic-Tac-Toe',
}
const getGameName = (id) => GAME_NAMES[id] ?? (id.charAt(0).toUpperCase() + id.slice(1))

export default function ArcadeShell({ onExit, onEvent }) {
  const [view, setView] = useState('picker')
  const [selectedGameId, setSelectedGameId] = useState(null)
  const [pauseLine, setPauseLine] = useState('')

  const viewRef      = useRef('picker')
  const panelRef     = useRef(null)
  const lastEntryRef = useRef(-1)
  const lastPauseRef = useRef(-1)
  const entryLineRef = useRef(null)

  if (entryLineRef.current === null) {
    entryLineRef.current = pickLine(ARCADE_ENTRY, lastEntryRef)
  }

  function setViewBoth(v) {
    viewRef.current = v
    setView(v)
  }

  function selectGame(id) {
    setSelectedGameId(id)
    setViewBoth('playing')
  }

  function handleResume() {
    panelRef.current?.resume()
    setViewBoth('playing')
  }

  function handleRestart() {
    panelRef.current?.launchById(selectedGameId)
    setViewBoth('playing')
  }

  // Stable: only touches refs and stable state setters — safe with [] deps.
  const handleEscape = useCallback(() => {
    if (viewRef.current === 'playing') {
      panelRef.current?.pause()
      setPauseLine(pickLine(ARCADE_PAUSE, lastPauseRef))
      viewRef.current = 'paused'
      setView('paused')
    } else if (viewRef.current === 'paused') {
      panelRef.current?.resume()
      viewRef.current = 'playing'
      setView('playing')
    }
  }, [])

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

  if (view === 'picker') {
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

  // 'playing' or 'paused' — panel stays mounted the whole time
  return (
    <div className="arcade-play-wrap">
      <ArcadePanel
        ref={panelRef}
        key={selectedGameId}
        initialGameId={selectedGameId}
        enableCycle={false}
        onEscape={handleEscape}
        onEvent={onEvent}
      />
      {view === 'paused' && (
        <div className="arcade-overlay">
          <div className="arcade-overlay__card">
            <p className="arcade-overlay__taunt">{pauseLine}</p>
            <div className="arcade-overlay__buttons">
              <button className="arcade-overlay__btn" onClick={handleResume}>
                Resume
              </button>
              <button className="arcade-overlay__btn" onClick={handleRestart}>
                Restart
              </button>
              <button
                className="arcade-overlay__btn arcade-overlay__btn--exit"
                onClick={onExit}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
