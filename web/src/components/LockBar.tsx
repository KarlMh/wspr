'use client'
import { useEffect, useState } from 'react'
import { getSessionIdentity, clearSessionIdentity } from '@/lib/identity'
import { usePathname, useRouter } from 'next/navigation'

export default function LockBar() {
  const [identity, setIdentity] = useState<{ publicKey: string } | null>(null)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    const id = getSessionIdentity()
    setIdentity(id)
  }, [pathname]) // re-check on every route change

  if (!identity) return null
  // Don't show on landing page
  if (pathname === '/') return null

  const handleLock = () => {
    clearSessionIdentity()
    // Clear message history on lock — contacts are kept
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('wspr_msgs_')) keys.push(k!)
    }
    keys.forEach(k => localStorage.removeItem(k))
    setIdentity(null)
    router.push('/app')
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      background: 'var(--bg)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      fontFamily: 'monospace',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ color: 'var(--text-5)', fontSize: '10px' }}>●</span>
        <span style={{ color: 'var(--text-5)', fontSize: '10px', letterSpacing: '0.05em' }}>
          {identity.publicKey.slice(0, 20)}...
        </span>
      </div>
      <button
        onClick={handleLock}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          color: 'var(--text-4)',
          cursor: 'pointer',
          fontSize: '10px',
          padding: '2px 10px',
          fontFamily: 'monospace',
          letterSpacing: '0.1em',
        }}
        className="uppercase hover:opacity-80"
      >
        🔒 lock
      </button>
    </div>
  )
}
