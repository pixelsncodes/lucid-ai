import DotMatrixCore from './dotmatrix-core'

export function DotmSquare1(props) {
  return (
    <DotMatrixCore
      rows={1}
      columns={1}
      shape="square"
      variant="pulse"
      label="Loading"
      {...props}
    />
  )
}

export default DotmSquare1
