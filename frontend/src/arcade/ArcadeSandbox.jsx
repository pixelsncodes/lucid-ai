import { useState } from 'react'
import './ArcadeSandbox.css'
import ArcadePanel from './ArcadePanel'
import { GAME_HELP } from './registry'

const MAX_EVENTS = 24

export default function ArcadeSandbox() {
  const [events,   setEvents]   = useState([])
  const [gameMeta, setGameMeta] = useState(null)

  const help = GAME_HELP[gameMeta?.id] ?? ''

  return (
    <div className="arcade-sandbox">
      <header className="sandbox-header">
        <h1>arcade dev sandbox</h1>
        {gameMeta && <span className="game-name">/{gameMeta.id}</span>}
      </header>

      <div className="sandbox-body">
        <ArcadePanel
          initialIndex={0}
          onEvent={e => setEvents(prev => [e, ...prev].slice(0, MAX_EVENTS))}
          onGameChange={meta => { setEvents([]); setGameMeta(meta) }}
        />

        <aside className="sandbox-events">
          <h2>events</h2>
          {events.map((e, i) => (
            <div key={i} className="event-entry">
              <span className="event-name">{e.name}</span>
              {e.data && Object.keys(e.data).length > 0 && (
                <span className="event-data">{JSON.stringify(e.data)}</span>
              )}
            </div>
          ))}
          {events.length === 0 && (
            <div className="event-entry" style={{ opacity: 0.4 }}>
              <span className="event-name">—</span>
            </div>
          )}
        </aside>
      </div>

      <footer className="sandbox-footer">
        {help && <span>{help} &nbsp;·&nbsp; </span>}
        <kbd>Tab</kbd> next game &nbsp;·&nbsp; <kbd>1</kbd>–<kbd>9</kbd> select
      </footer>
    </div>
  )
}
