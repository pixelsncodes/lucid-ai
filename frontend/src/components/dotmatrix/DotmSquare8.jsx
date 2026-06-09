import DotMatrixCore from './dotmatrix-core'

export function DotmSquare8(props) {
  return (
    <DotMatrixCore
      rows={2}
      columns={4}
      shape="square"
      variant="pulse"
      centerOut
      label="Loading"
      {...props}
    />
  )
}

export default DotmSquare8
