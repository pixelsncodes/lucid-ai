// Shared visual constants — game grid uses the same language as the face matrix.
// Source of truth: DotMatrix DEFAULTS in components/matrix/DotMatrix.jsx.
export const DOT_COLOR = '#e4e2da'
export const DOT_SIZE  = 22        // px  (same as face matrix)
export const DOT_GAP   = 14        // px  (same as face matrix)
export const OP_OFF    = 0.09      // opGrid — unlit background dot
export const OP_DIM    = 0.13      // opBase — secondary element (walls, score pips)
export const OP_LIT    = 1.0       // opPeak — active element (ball, paddle, score)

// Flat-buffer dot states
export const OFF = 0
export const DIM = 1
export const LIT = 2
