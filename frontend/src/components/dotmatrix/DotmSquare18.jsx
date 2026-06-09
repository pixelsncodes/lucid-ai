import DotMatrixCore from './dotmatrix-core'

export function DotmSquare18(props) {
  return (
    <DotMatrixCore
      rows={3}
      columns={6}
      shape="square"
      variant="wave"
      label="Loading"
      {...props}
    />
  )
}

export default DotmSquare18
