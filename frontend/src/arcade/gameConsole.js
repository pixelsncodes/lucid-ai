/**
 * Game console factory.
 *
 * ── Contract every game must implement ─────────────────────────────────────
 *
 * {
 *   meta: {
 *     id: string,
 *     name: string,
 *     renderer?: 'matrix' | 'canvas',   // default 'matrix'
 *     // matrix games also require:
 *     gridSize: { cols: number, rows: number },
 *     // canvas games also require:
 *     logicalWidth: number,
 *     logicalHeight: number,
 *   },
 *
 *   init(api: GameAPI): void,
 *   // Called once at startup. Matrix games draw their first frame here.
 *   // Canvas games may defer drawing to render().
 *
 *   input(event: GameInputEvent): void,
 *   // Structured events: { type: 'keydown'|'keyup', key: string }
 *   //                  | { type: 'mouse_y'|'touch_y', row: number }
 *   // For canvas games row is in logical px (0..logicalHeight).
 *
 *   tick(dt: number): void,
 *   // Called at fixed 60fps timestep. dt is always ~16.67ms.
 *   // Update game state only — do not draw in canvas games.
 *
 *   render?(ctx: CanvasRenderingContext2D, { w: number, h: number }): void,
 *   // Canvas games only. Called once per frame after tick().
 *   // ctx transform is pre-scaled: draw in logical coordinates (0..w, 0..h).
 *
 *   destroy(): void,
 *   // Cleanup. Called when the console is torn down.
 * }
 *
 * ── GameAPI ─────────────────────────────────────────────────────────────────
 *
 * {
 *   setDot(col, row, state: 0|1|2): void,   // matrix games only
 *   clearGrid(): void,                        // matrix games only
 *   emit(name: string, data?: object): void,
 * }
 *
 * ── Semantic events games must emit ─────────────────────────────────────────
 *
 *   game_start    — game or round begins
 *   scrap_scored  — SCRAP scored a point
 *   player_scored — player scored a point
 *   near_miss     — ball barely hit/missed a paddle
 *   scrap_won     — SCRAP wins the match
 *   scrap_lost    — player wins the match
 *   game_quit     — player quits mid-game
 */

const TICK_MS = 1000 / 60   // fixed timestep ≈ 16.67 ms

export function createConsole(game, { onDraw, onEvent, getCanvasCtx } = {}) {
  const { cols = 0, rows = 0 } = game.meta.gridSize ?? {}
  const dots = new Uint8Array(cols * rows)

  const api = {
    setDot(col, row, state) {
      if (col >= 0 && col < cols && row >= 0 && row < rows) {
        dots[row * cols + col] = state
      }
    },
    clearGrid() { dots.fill(0) },
    emit(name, data) {
      onEvent?.({ name, data: data ?? null, t: Date.now() })
    },
  }

  let rafId       = null
  let lastTime    = null
  let accumulated = 0
  let destroyed   = false

  function frame(timestamp) {
    if (destroyed) return

    if (lastTime === null) lastTime = timestamp
    const elapsed = timestamp - lastTime
    lastTime = timestamp
    // Cap at 150ms to prevent spiral-of-death after a tab suspend
    accumulated += Math.min(elapsed, 150)

    while (accumulated >= TICK_MS) {
      game.tick(TICK_MS)
      accumulated -= TICK_MS
    }

    if (game.render && getCanvasCtx) {
      const c = getCanvasCtx()
      if (c) game.render(c.ctx, { w: c.w, h: c.h })
    } else {
      onDraw?.(dots)
    }
    rafId = requestAnimationFrame(frame)
  }

  function pause() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
      // Reset accumulator so we don't over-tick on resume
      lastTime    = null
      accumulated = 0
    }
  }

  function resume() {
    if (rafId === null && !destroyed) {
      rafId = requestAnimationFrame(frame)
    }
  }

  function handleVisibility() {
    if (document.hidden) pause()
    else resume()
  }

  function start() {
    game.init(api)
    document.addEventListener('visibilitychange', handleVisibility)
    rafId = requestAnimationFrame(frame)
  }

  function destroy() {
    destroyed = true
    pause()
    document.removeEventListener('visibilitychange', handleVisibility)
    game.destroy?.()
  }

  return { start, pause, resume, destroy, meta: game.meta }
}
