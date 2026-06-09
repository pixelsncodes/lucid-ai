import { useEffect, useMemo, useState } from 'react'

export function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener?.('change', updatePreference)

    return () => {
      mediaQuery.removeEventListener?.('change', updatePreference)
    }
  }, [])

  return prefersReducedMotion
}

export function useDotMatrixCells({ rows, columns, stagger = 0.04, centerOut = false }) {
  return useMemo(() => {
    const centerRow = (rows - 1) / 2
    const centerColumn = (columns - 1) / 2

    return Array.from({ length: rows * columns }, (_, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const distance = centerOut
        ? Math.hypot(row - centerRow, column - centerColumn)
        : row + column

      return {
        index,
        row,
        column,
        delay: Number((distance * stagger).toFixed(3)),
      }
    })
  }, [centerOut, columns, rows, stagger])
}

export function useDotMatrixSize(size, fallback = 8) {
  return useMemo(() => {
    const nextSize = Number(size)
    return Number.isFinite(nextSize) && nextSize > 0 ? nextSize : fallback
  }, [fallback, size])
}
