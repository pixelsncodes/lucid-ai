import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

/**
 * DPI-aware 2D canvas for canvas-renderer games.
 *
 * The parent calls ref.getCtx() each frame (from the game console's render
 * callback). getCtx() returns { ctx, w, h } where w/h are the logical
 * dimensions — the ctx transform is pre-scaled so games always draw in
 * logical coordinates.
 *
 * ResizeObserver keeps the backing store in sync with the display size × dpr.
 */
const GameCanvas = forwardRef(function GameCanvas(
  { logicalWidth = 640, logicalHeight = 384, cssWidth = 640, cssHeight = 384 },
  ref,
) {
  const canvasRef = useRef(null)

  useImperativeHandle(ref, () => ({
    getCtx() {
      const canvas = canvasRef.current
      if (!canvas) return null
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // Map logical coordinates to physical pixels via pre-scaling.
      // canvas.width/height are already dpr-adjusted by the ResizeObserver.
      ctx.setTransform(
        canvas.width  / logicalWidth,
        0, 0,
        canvas.height / logicalHeight,
        0, 0,
      )
      return { ctx, w: logicalWidth, h: logicalHeight }
    },
    // Expose the DOM element so ArcadeSandbox can read its bounding rect for tap events.
    getCanvas() { return canvasRef.current },
  }), [logicalWidth, logicalHeight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        canvas.width  = Math.round(width  * dpr)
        canvas.height = Math.round(height * dpr)
      }
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width:   `${cssWidth}px`,
        height:  `${cssHeight}px`,
      }}
    />
  )
})

export default GameCanvas
