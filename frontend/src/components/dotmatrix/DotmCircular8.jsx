import DotMatrixCore from './dotmatrix-core'

export function DotmCircular8(props) {
  return (
    <DotMatrixCore
      rows={2}
      columns={4}
      shape="circle"
      variant="pulse"
      centerOut
      label="Loading"
      {...props}
    />
  )
}

export default DotmCircular8
