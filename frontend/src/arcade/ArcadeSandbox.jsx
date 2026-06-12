import { useEffect, useRef, useState } from 'react'
import './ArcadeSandbox.css'
import GameGrid from './GameGrid'
import { createConsole } from './gameConsole'
import { createPong } from './games/pong'

const MAX_EVENTS = 24

export default function ArcadeSandbox() {
  const gridRef  = useRef(null)   // GameGrid imperative handle
  const arenaRef = useRef(null)   // DOM wrapper for coordinate math
  const gameRef  = useRef(null)   // live game instance

  const [events,  setEvents]  = useState([])
  const [gameMeta, setGameMeta] = useState(null)

  useEffect(() => {
    const game = createPong()
    gameRef.current = game
    setGameMeta(game.meta)

    const cons = createConsole(game, {
      onDraw(dots) {
        gridRef.current?.setDots(dots)
      },
      onEvent(e) {
        setEvents(prev => [e, ...prev].slice(0, MAX_EVENTS))
      },
    })

    // ── Input wiring ────────────────────────────────────────────────────────

    function toRow(clientY) {
      if (!arenaRef.current) return null
      const rect = arenaRef.current.getBoundingClientRect()
      const frac = (clientY - rect.top) / rect.height
      return frac * game.meta.gridSize.rows
    }

    function onKey(e) {
      if (['ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault()
      game.input({ type: e.type, key: e.key })
    }

    function onMouseMove(e) {
      const row = toRow(e.clientY)
      if (row !== null) game.input({ type: 'mouse_y', row })
    }

    function onMouseLeave() {
      // Stop mouse tracking when cursor leaves arena; arrow keys take over
      game.input({ type: 'mouse_y', row: null })
    }

    function onTouch(e) {
      const touch = e.touches[0] || e.changedTouches[0]
      if (!touch) return
      const row = toRow(touch.clientY)
      if (row !== null) game.input({ type: 'touch_y', row })
    }

    const arena = arenaRef.current
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup',   onKey)
    arena?.addEventListener('mousemove',  onMouseMove)
    arena?.addEventListener('mouseleave', onMouseLeave)
    arena?.addEventListener('touchstart', onTouch, { passive: true })
    arena?.addEventListener('touchmove',  onTouch, { passive: true })

    cons.start()

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup',   onKey)
      arena?.removeEventListener('mousemove',  onMouseMove)
      arena?.removeEventListener('mouseleave', onMouseLeave)
      arena?.removeEventListener('touchstart', onTouch)
      arena?.removeEventListener('touchmove',  onTouch)
      cons.destroy()
      gameRef.current = null
    }
  }, [])

  const { cols = 24, rows = 14 } = gameMeta?.gridSize ?? {}

  return (
    <div className="arcade-sandbox">
      <header className="sandbox-header">
        <h1>arcade dev sandbox</h1>
        {gameMeta && <span className="game-name">/{gameMeta.id}</span>}
      </header>

      <div className="sandbox-body">
        <div className="sandbox-arena" ref={arenaRef}>
          <GameGrid
            ref={gridRef}
            cols={cols}
            rows={rows}
            dotSize={10}
            gap={5}
          />
        </div>

        <aside className="sandbox-events">
          <h2>events</h2>
          {events.map((e, i) => (
            <div key={i} className="event-entry">
              <span className="event-name">{e.name}</span>
              {e.data && Object.keys(e.data).length > 0 && (
                <span className="event-data">{JSON.stringify(e.data)}</span>
              )}
            </div>
          ))}
          {events.length === 0 && (
            <div className="event-entry" style={{ opacity: 0.4 }}>
              <span className="event-name">—</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="sandbox-footer">
        <kbd>mouse</kbd> or <kbd>↑↓</kbd> move paddle &nbsp;·&nbsp;
        <kbd>Esc</kbd> pause &nbsp;·&nbsp;
        first to 5 wins &nbsp;·&nbsp;
        <kbd>Esc</kbd> or <kbd>Space</kbd> restart after win
      </footer>
    </div>
  )
}
