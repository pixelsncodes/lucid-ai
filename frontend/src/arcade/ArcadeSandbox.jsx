import { useEffect, useRef, useState } from 'react'
import './ArcadeSandbox.css'
import GameGrid from './GameGrid'
import { createConsole } from './gameConsole'
import { createPong }     from './games/pong'
import { createSnake }    from './games/snake'
import { createBreakout } from './games/breakout'
import { createInvaders } from './games/invaders'
import { createTetris }   from './games/tetris'
import { createFrogger }  from './games/frogger'

const MAX_EVENTS = 24

const GAME_FACTORIES = [
  createPong,
  createSnake,
  createBreakout,
  createInvaders,
  createTetris,
  createFrogger,
]

const GAME_HELP = {
  pong:     'mouse or ↑↓ paddle · Esc pause · first to 5 · Space restart',
  snake:    '↑↓←→ steer · Space start/restart · Esc quit',
  breakout: '←→ paddle · mouse↕ = paddle x · Space restart',
  invaders: '←→ move · Space fire · Esc pause',
  tetris:   '←→ move · ↑ rotate · ↓ soft drop · Space hard drop · Esc pause',
  frogger:  '↑↓←→ hop · Space restart',
}

export default function ArcadeSandbox() {
  const gridRef     = useRef(null)
  const arenaRef    = useRef(null)
  const consRef     = useRef(null)     // current GameConsole
  const gameRef     = useRef(null)     // current game object (for input forwarding)
  const idxRef      = useRef(0)
  const launchRef   = useRef(null)     // stable pointer to launchGame for effect closures

  const [events,   setEvents]   = useState([])
  const [gameMeta, setGameMeta] = useState(null)

  function launchGame(idx) {
    consRef.current?.destroy()
    setEvents([])

    const n = ((idx % GAME_FACTORIES.length) + GAME_FACTORIES.length) % GAME_FACTORIES.length
    idxRef.current = n

    const game = GAME_FACTORIES[n]()
    gameRef.current = game
    setGameMeta(game.meta)

    const cons = createConsole(game, {
      onDraw(dots) { gridRef.current?.setDots(dots) },
      onEvent(e)   { setEvents(prev => [e, ...prev].slice(0, MAX_EVENTS)) },
    })
    consRef.current = cons
    cons.start()
  }

  // Keep stable ref so the event handlers added in useEffect can always
  // call the latest version of launchGame (which closes over React state setters).
  launchRef.current = launchGame

  useEffect(() => {
    launchRef.current(0)

    function toRow(clientY) {
      if (!arenaRef.current) return null
      const rect = arenaRef.current.getBoundingClientRect()
      const frac = (clientY - rect.top) / rect.height
      const rows = gameRef.current?.meta?.gridSize?.rows ?? 14
      return frac * rows
    }

    function onKey(e) {
      const prevent = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']
      if (prevent.includes(e.key)) e.preventDefault()

      if (e.type === 'keydown' && e.key === 'Tab') {
        e.preventDefault()
        launchRef.current(idxRef.current + (e.shiftKey ? -1 : 1))
        return
      }

      if (e.type === 'keydown' && /^[1-6]$/.test(e.key)) {
        launchRef.current(parseInt(e.key) - 1)
        return
      }

      gameRef.current?.input({ type: e.type, key: e.key })
    }

    function onMouseMove(e) {
      const row = toRow(e.clientY)
      if (row !== null) gameRef.current?.input({ type: 'mouse_y', row })
    }

    function onMouseLeave() {
      gameRef.current?.input({ type: 'mouse_y', row: null })
    }

    function onTouch(e) {
      const touch = e.touches[0] || e.changedTouches[0]
      if (!touch) return
      const row = toRow(touch.clientY)
      if (row !== null) gameRef.current?.input({ type: 'touch_y', row })
    }

    const arena = arenaRef.current
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup',   onKey)
    arena?.addEventListener('mousemove',  onMouseMove)
    arena?.addEventListener('mouseleave', onMouseLeave)
    arena?.addEventListener('touchstart', onTouch, { passive: true })
    arena?.addEventListener('touchmove',  onTouch, { passive: true })

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup',   onKey)
      arena?.removeEventListener('mousemove',  onMouseMove)
      arena?.removeEventListener('mouseleave', onMouseLeave)
      arena?.removeEventListener('touchstart', onTouch)
      arena?.removeEventListener('touchmove',  onTouch)
      consRef.current?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { cols = 24, rows = 14 } = gameMeta?.gridSize ?? {}
  const help = GAME_HELP[gameMeta?.id] ?? ''

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
        {help && <span>{help} &nbsp;·&nbsp; </span>}
        <kbd>Tab</kbd> next game &nbsp;·&nbsp; <kbd>1</kbd>–<kbd>6</kbd> select
      </footer>
    </div>
  )
}
