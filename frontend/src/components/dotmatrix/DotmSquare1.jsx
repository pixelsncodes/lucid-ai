import { DotMatrixBase } from './dotmatrix-core'
import { useDotMatrixPhases } from './dotmatrix-hooks'
import { trBlPathNormFromIndex } from './dotmatrix-core'
import { usePrefersReducedMotion } from './dotmatrix-hooks'
const animationResolver = ({
  isActive,
  index,
  row,
  col,
  reducedMotion,
  phase
}) => {
  if (!isActive) {
    return {
      className: "dmx-inactive"
    }
  }
  const path = trBlPathNormFromIndex(index)
  const slice = row + (4 - col)
  const parity = slice % 2
  const style = {
    "--dmx-path": path,
    "--dmx-diagonal-parity": parity
  }
  if (reducedMotion || phase === "idle") {
    return {
      style: {
        ...style,
        opacity: parity === 0 ? 0.88 : 0.14
      }
    }
  }
  return {
    className: "dmx-diagonal-alt-sweep",
    style
  }
}
export function DotmSquare1({
  speed = 1,
  pattern = "full",
  animated = true,
  hoverAnimated = false,
  ...rest
}) {
  const reducedMotion = usePrefersReducedMotion()
  const {
    phase: matrixPhase,
    onMouseEnter,
    onMouseLeave
  } = useDotMatrixPhases({
    animated: Boolean(animated && !reducedMotion),
    hoverAnimated: Boolean(hoverAnimated && !reducedMotion),
    speed
  })
  return <DotMatrixBase {...rest} speed={speed} pattern={pattern} animated={animated} phase={matrixPhase} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} reducedMotion={reducedMotion} animationResolver={animationResolver} />
}

export default DotmSquare1
