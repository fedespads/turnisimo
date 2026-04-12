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
  const [activeTab, setActiveTab] = useState('view')
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

  function handleCopyLocalStorage() {
    try {
      const snapshot = {}
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (!key) continue
        snapshot[key] = window.localStorage.getItem(key)
      }

      const payload = JSON.stringify(snapshot, null, 2)

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).catch(() => {
          window.prompt('Copia questo backup del localStorage:', payload)
        })
      } else {
        window.prompt('Copia questo backup del localStorage:', payload)
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="app app-root">
      <header className="app-header app-header-main app-header-with-actions">
        <h1 className="app-title">Turni Simo</h1>
        <button
          type="button"
          className="icon-button-ghost app-debug-copy-button"
          onClick={handleCopyLocalStorage}
        >
          Copia dati
        </button>
      </header>

      <main className="app-main app-content">
        {activeTab === 'timbrature' && <TimbraturePage />}
        {activeTab === 'view' && <ScheduleViewPage />}
      </main>

      <nav className="bottom-nav app-bottom-nav">
        <button
          type="button"
          className={
            'bottom-nav-item bottom-nav-item-view' +
            (activeTab === 'view' ? ' active' : '')
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
            'bottom-nav-item bottom-nav-item-timbrature' +
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
