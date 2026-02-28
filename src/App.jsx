import { useEffect, useState } from 'react'
import './App.css'
import { TimbraturePage } from './TimbraturePage'
import { ScheduleViewPage } from './ScheduleViewPage'

function useColorScheme() {
  const [scheme, setScheme] = useState('dark')

  useEffect(() => {
    if (!window.matchMedia) return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: light)')

    function handleChange(event) {
      setScheme(event.matches ? 'light' : 'dark')
    }

    handleChange(mediaQuery)
    mediaQuery.addEventListener('change', handleChange)

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return scheme
}

function App() {
  // trigger deploy
  const [activeTab, setActiveTab] = useState('timbrature')
  const colorScheme = useColorScheme()
  const isDark = colorScheme === 'dark'

  const base = import.meta.env.BASE_URL

  const timbratureIconSrc =
    base + (activeTab === 'timbrature'
      ? 'clock.badge.fill.png'
      : 'clock.badge.png')

  const viewIconSrc =
    base + (activeTab === 'view'
      ? 'list.bullet.clipboard.fill.png'
      : 'list.bullet.clipboard.png')

  const iconClassName =
    'nav-icon ' + (isDark ? 'nav-icon-dark' : 'nav-icon-light')

  return (
    <div className="app">
      <header className="app-header">
        <h1>Turni Simo</h1>
      </header>

      <main className="app-main">
        {activeTab === 'timbrature' && <TimbraturePage />}
        {activeTab === 'view' && <ScheduleViewPage />}
      </main>

      <nav className="bottom-nav">
        <button
          type="button"
          className={
            'bottom-nav-item' + (activeTab === 'view' ? ' active' : '')
          }
          onClick={() => setActiveTab('view')}
        >
          <img
            src={viewIconSrc}
            alt="Turni"
            className={iconClassName}
          />
        </button>
        <button
          type="button"
          className={
            'bottom-nav-item' +
            (activeTab === 'timbrature' ? ' active' : '')
          }
          onClick={() => setActiveTab('timbrature')}
        >
          <img
            src={timbratureIconSrc}
            alt="Timbrature"
            className={iconClassName}
          />
        </button>
      </nav>
    </div>
  )
}

export default App
