'use client'
import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('wspr_theme') as Theme | null
    if (saved) apply(saved)
    else apply('dark')
  }, [])

  function apply(t: Theme) {
    setTheme(t)
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('wspr_theme', t)
  }

  function toggle() { apply(theme === 'dark' ? 'light' : 'dark') }

  return { theme, toggle }
}
