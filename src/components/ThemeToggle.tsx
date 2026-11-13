import { useEffect, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'internethealth.theme'
const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage unavailable (private mode); the choice just won't persist.
    }
  }, [theme])

  return (
    <button type="button" className="button" onClick={() => setTheme(NEXT[theme])} title="Cycle theme">
      Theme: {theme}
    </button>
  )
}
