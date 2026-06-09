import './dotmatrix-loader.css'

import { useDotMatrixCells, useDotMatrixSize, usePrefersReducedMotion } from './dotmatrix-hooks'

const DEFAULT_COLOR = 'currentColor'

function toStyleValue(value) {
  return typeof value === 'number' ? `${value}px` : value
}

export function DotMatrixCore({
  columns = 8,
  rows = 8,
  dotSize = 8,
  gap = 4,
  color = DEFAULT_COLOR,
  inactiveColor,
  shape = 'square',
  variant = 'pulse',
  speed = 1,
  stagger = 0.04,
  centerOut = false,
  className = '',
  style,
  dotClassName = '',
  label = 'Loading',
  role = 'status',
  'aria-label': ariaLabel,
  ...props
}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const safeDotSize = useDotMatrixSize(dotSize)
  const safeGap = useDotMatrixSize(gap, 4)
  const cells = useDotMatrixCells({ rows, columns, stagger, centerOut })
  const classNames = [
    'dotmatrix-loader',
    `dotmatrix-loader--${shape}`,
    `dotmatrix-loader--${variant}`,
    prefersReducedMotion ? 'dotmatrix-loader--reduced-motion' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={classNames}
      role={role}
      aria-label={ariaLabel || label}
      style={{
        '--dotmatrix-columns': columns,
        '--dotmatrix-rows': rows,
        '--dotmatrix-size': toStyleValue(safeDotSize),
        '--dotmatrix-gap': toStyleValue(safeGap),
        '--dotmatrix-color': color,
        '--dotmatrix-inactive-color': inactiveColor || color,
        '--dotmatrix-speed': `${speed}s`,
        ...style,
      }}
      {...props}
    >
      {cells.map((cell) => (
        <span
          key={cell.index}
          className={`dotmatrix-loader__dot ${dotClassName}`.trim()}
          style={{
            '--dotmatrix-row': cell.row,
            '--dotmatrix-column': cell.column,
            '--dotmatrix-delay': `${cell.delay}s`,
          }}
        />
      ))}
    </span>
  )
}

export default DotMatrixCore
