const primaryItems = ['Voice', 'Chat', 'Sessions', 'Models', 'Settings', 'Logs']
const utilityItems = ['System', 'Help']

function Sidebar() {
  return (
    <aside className="lucid-sidebar" aria-label="Primary navigation">
      <div className="sidebar-mark">L</div>
      <nav className="sidebar-nav" aria-label="Main">
        {primaryItems.map((item) => (
          <button
            type="button"
            className={`sidebar-item ${item === 'Voice' ? 'sidebar-item--active' : ''}`}
            key={item}
          >
            <span className="sidebar-item-dot" aria-hidden="true" />
            <span className="sidebar-item-label">{item}</span>
          </button>
        ))}
      </nav>
      <nav className="sidebar-nav sidebar-nav--utility" aria-label="Utility">
        {utilityItems.map((item) => (
          <button type="button" className="sidebar-item" key={item}>
            <span className="sidebar-item-dot" aria-hidden="true" />
            <span className="sidebar-item-label">{item}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
