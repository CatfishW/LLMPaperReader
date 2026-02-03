import { useEffect, useMemo, useState } from 'react'

type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'llmpr-theme'

function getStoredTheme(): Theme {
  const saved = window.localStorage.getItem(THEME_KEY) as Theme | null
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', theme)
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(theme)
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const options = useMemo(
    () => [
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
      { value: 'system', label: 'System' }
    ],
    []
  )

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-option ${theme === option.value ? 'is-active' : ''}`}
          onClick={() => setTheme(option.value as Theme)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
