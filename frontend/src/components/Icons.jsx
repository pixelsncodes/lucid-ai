// Minimal stroke icons — 16×16 viewBox, 1.5px stroke, currentColor.

const base = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export function GearIcon() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </svg>
  )
}

export function MicIcon() {
  return (
    <svg {...base}>
      <rect x="6" y="1.8" width="4" height="7.4" rx="2" />
      <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.2" />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg {...base}>
      <rect x="4.2" y="4.2" width="7.6" height="7.6" rx="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SendIcon() {
  return (
    <svg {...base}>
      <path d="M8 13V3M3.8 7.2 8 3l4.2 4.2" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  )
}

export function SpeakerIcon() {
  return (
    <svg {...base}>
      <path d="M2.5 6v4h2.6L9 13V3L5.1 6H2.5z" />
      <path d="M11 5.5a3.6 3.6 0 0 1 0 5" />
    </svg>
  )
}
