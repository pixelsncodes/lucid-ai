function AppShell({ topbar, children }) {
  return (
    <main className="lucid-shell">
      <div className="lucid-main">
        {topbar}
        {children}
      </div>
    </main>
  )
}

export default AppShell
