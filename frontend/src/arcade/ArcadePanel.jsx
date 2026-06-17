import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import './ArcadePanel.css'
import GameCanvas from './GameCanvas'
import { createConsole } from './gameConsole'
import { GAMES, findGameIndex } from './registry'

const ArcadePanel = forwardRef(function ArcadePanel(
  { initialIndex = 0, initialGameId, onEvent, onGameChange },
  ref,
) {
  const canvasRef = useRef(null)
  const arenaRef  = useRef(null)
  const consRef   = useRef(null)
  const gameRef   = useRef(null)
  const idxRef    = useRef(0)
  const launchRef = useRef(null)

  const [gameMeta, setGameMeta] = useState(null)

  function launchGame(idx) {
    consRef.current?.destroy()
    const n = ((idx % GAMES.length) + GAMES.length) % GAMES.length
    idxRef.current = n
    const game = GAMES[n].create()
    gameRef.current = game
    setGameMeta(game.meta)
    onGameChange?.(game.meta)
    const cons = createConsole(game, {
      getCanvasCtx: () => canvasRef.current?.getCtx() ?? null,
      onEvent: (e) => onEvent?.(e),
    })
    consRef.current = cons
    cons.start()
  }
  launchRef.current = launchGame

  useImperativeHandle(ref, () => ({
    launchByIndex: (i) => launchRef.current(i),
    launchById: (id) => {
      const i = findGameIndex(id)
      if (i !== -1) launchRef.current(i)
    },
    next: () => launchRef.current(idxRef.current + 1),
    prev: () => launchRef.current(idxRef.current - 1),
    getActiveMeta: () => gameRef.current?.meta ?? null,
  }), [])

  useEffect(() => {
    const startIdx = initialGameId != null ? findGameIndex(initialGameId) : -1
    launchRef.current(startIdx !== -1 ? startIdx : initialIndex)

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

    function toLogical(clientX, clientY) {
      const canvas = canvasRef.current?.getCanvas()
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      const meta = gameRef.current?.meta
      const lw = meta?.logicalWidth  ?? 640
      const lh = meta?.logicalHeight ?? 384
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

  return (
    <div className="arcade-panel" ref={arenaRef}>
      <GameCanvas
        ref={canvasRef}
        logicalWidth={gameMeta?.logicalWidth   ?? 640}
        logicalHeight={gameMeta?.logicalHeight ?? 384}
        cssWidth={gameMeta?.logicalWidth   ?? 640}
        cssHeight={gameMeta?.logicalHeight ?? 384}
      />
    </div>
  )
})

export default ArcadePanel
