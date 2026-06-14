import { useEffect, useRef, useState } from 'react'
import './ArcadeSandbox.css'
import GameCanvas from './GameCanvas'
import { createConsole } from './gameConsole'
import { createPong }     from './games/pong'
import { createSnake }    from './games/snake'
import { createBreakout } from './games/breakout'
import { createInvaders } from './games/invaders'
import { createTetris }   from './games/tetris'
import { createFrogger }  from './games/frogger'
import { createTron }       from './games/tron'
import { createConnect4 }   from './games/connect4'

const MAX_EVENTS = 24

const GAME_FACTORIES = [
  createPong,
  createSnake,
  createBreakout,
  createInvaders,
  createTetris,
  createFrogger,
  createTron,
  createConnect4,
]

const GAME_HELP = {
  pong:     'mouse or ↑↓ paddle · Esc quit · first to 7 · Space restart',
  snake:    '↑↓←→ steer · Space start/restart · Esc quit',
  breakout: '←→ paddle · mouse↕ = paddle x · Space restart',
  invaders: '←→ move · Space fire · Esc pause',
  tetris:   '←→ move · ↑ rotate · ↓ soft drop · Space hard drop · Esc pause',
  frogger:  '↑↓←→ hop · Space restart',
  tron:      '↑↓←→ or WASD steer · Esc quit · first to 3 rounds',
  connect4:  '←→ cursor · Space/tap drop · Esc quit',
}

export default function ArcadeSandbox() {
  const canvasRef  = useRef(null)
  const arenaRef   = useRef(null)
  const consRef    = useRef(null)
  const gameRef    = useRef(null)
  const idxRef     = useRef(0)
  const launchRef  = useRef(null)

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
      getCanvasCtx: () => canvasRef.current?.getCtx() ?? null,
      onEvent: (e) => setEvents(prev => [e, ...prev].slice(0, MAX_EVENTS)),
    })
    consRef.current = cons
    cons.start()
  }

  launchRef.current = launchGame

  useEffect(() => {
    launchRef.current(0)

    function toRow(clientY) {
      if (!arenaRef.current) return null
      const rect = arenaRef.current.getBoundingClientRect()
      const frac = (clientY - rect.top) / rect.height
      const game = gameRef.current
      return frac * (game?.meta?.logicalHeight ?? 384)
    }

    function onKey(e) {
      const prevent = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']
      if (prevent.includes(e.key)) e.preventDefault()

      if (e.type === 'keydown' && e.key === 'Tab') {
        e.preventDefault()
        launchRef.current(idxRef.current + (e.shiftKey ? -1 : 1))
        return
      }

      if (e.type === 'keydown' && /^[1-9]$/.test(e.key)) {
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

    // tap — convert pointer to logical {x,y} using the canvas bounding rect.
    // Used by grid games (Connect Four, Tic-Tac-Toe) for column/cell selection.
    // Existing games ignore tap events, so this is purely additive.
    function toLogical(clientX, clientY) {
      const canvas = canvasRef.current?.getCanvas()
      if (!canvas) return null
      const rect   = canvas.getBoundingClientRect()
      const meta   = gameRef.current?.meta
      const lw     = meta?.logicalWidth  ?? 640
      const lh     = meta?.logicalHeight ?? 384
      return {
        x: ((clientX - rect.left) / rect.width)  * lw,
        y: ((clientY - rect.top)  / rect.height) * lh,
      }
    }

    function onMouseDown(e) {
      const pos = toLogical(e.clientX, e.clientY)
      if (pos) gameRef.current?.input({ type: 'tap', x: pos.x, y: pos.y })
    }

    function onTouchStart(e) {
      const touch = e.touches[0] || e.changedTouches[0]
      if (!touch) return
      const pos = toLogical(touch.clientX, touch.clientY)
      if (pos) gameRef.current?.input({ type: 'tap', x: pos.x, y: pos.y })
      // Also send touch_y for paddle games
      if (pos) gameRef.current?.input({ type: 'touch_y', row: pos.y })
    }

    const arena = arenaRef.current
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup',   onKey)
    arena?.addEventListener('mousemove',  onMouseMove)
    arena?.addEventListener('mouseleave', onMouseLeave)
    arena?.addEventListener('mousedown',  onMouseDown)
    arena?.addEventListener('touchstart', onTouchStart, { passive: true })
    arena?.addEventListener('touchmove',  onTouch,      { passive: true })

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup',   onKey)
      arena?.removeEventListener('mousemove',  onMouseMove)
      arena?.removeEventListener('mouseleave', onMouseLeave)
      arena?.removeEventListener('mousedown',  onMouseDown)
      arena?.removeEventListener('touchstart', onTouchStart)
      arena?.removeEventListener('touchmove',  onTouch)
      consRef.current?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const help = GAME_HELP[gameMeta?.id] ?? ''

  return (
    <div className="arcade-sandbox">
      <header className="sandbox-header">
        <h1>arcade dev sandbox</h1>
        {gameMeta && <span className="game-name">/{gameMeta.id}</span>}
      </header>

      <div className="sandbox-body">
        <div className="sandbox-arena" ref={arenaRef}>
          <GameCanvas
            ref={canvasRef}
            logicalWidth={gameMeta?.logicalWidth   ?? 640}
            logicalHeight={gameMeta?.logicalHeight ?? 384}
            cssWidth={gameMeta?.logicalWidth   ?? 640}
            cssHeight={gameMeta?.logicalHeight ?? 384}
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
        <kbd>Tab</kbd> next game &nbsp;·&nbsp; <kbd>1</kbd>–<kbd>9</kbd> select
      </footer>
    </div>
  )
}
