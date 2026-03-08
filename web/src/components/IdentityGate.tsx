'use client'
import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { generateKeyPair, exportPrivateKey } from '@/lib/keys'
import { encryptIdentity, downloadIdentityFile, decryptIdentity, readFileAsBytes, setSessionIdentity, getSessionIdentity, type Identity } from '@/lib/identity'
import Link from 'next/link'

type Props = {
  backHref: string
  backLabel?: string
  title: string
  onIdentityReady: (identity: Identity) => void
}

const S = {
  bg:  { background: 'var(--bg)' },
  bg2: { background: 'var(--bg-2)' },
  t1:  { color: 'var(--text-1)' },
  t2:  { color: 'var(--text-2)' },
  t3:  { color: 'var(--text-3)' },
  t4:  { color: 'var(--text-4)' },
  t5:  { color: 'var(--text-5)' },
}

export default function IdentityGate({ backHref, backLabel = '← back', title, onIdentityReady }: Props) {
  const { theme, toggle: toggleTheme } = useTheme()
  const [mode, setMode] = useState<'load' | 'create'>('load')
  const [pendingFile, setPendingFile] = useState<Uint8Array | null>(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const session = getSessionIdentity()
    if (session) onIdentityReady(session)
  }, [onIdentityReady])

  const handleFileLoad = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(await readFileAsBytes(f))
    setPendingFileName(f.name)
  }

  const handleUnlock = async () => {
    if (!pendingFile) return setError('Select a .wspr file first.')
    if (!password.trim()) return setError('Password required.')
    setLoading(true); setError('')
    try {
      const id = await decryptIdentity(pendingFile, password)
      if (!id) return setError('Wrong password or invalid file.')
      setSessionIdentity(id)
      onIdentityReady(id)
    } catch { setError('Failed to unlock.') }
    finally { setLoading(false) }
  }

  const handleCreate = async () => {
    if (!password.trim()) return setError('Password required.')
    if (password !== password2) return setError('Passwords do not match.')
    if (password.length < 8) return setError('Min 8 characters.')
    setLoading(true); setError('')
    try {
      const pair = await generateKeyPair()
      const privRaw = await exportPrivateKey(pair.privateKey)
      const id: Identity = { publicKey: pair.publicKeyRaw, privateKeyRaw: privRaw, createdAt: Date.now() }
      downloadIdentityFile(await encryptIdentity(id, password), 'wspr-identity.wspr')
      setSessionIdentity(id)
      onIdentityReady(id)
    } catch { setError('Failed to create identity.') }
    finally { setLoading(false) }
  }

  const inputStyle = { ...S.bg2, border: '1px solid var(--border)', ...S.t1 }

  return (
    <main style={{ ...S.bg, ...S.t1, fontFamily: 'monospace', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', ...S.bg }} className="px-4 py-3 flex items-center justify-between">
        <span style={S.t3} className="text-xs tracking-widest uppercase">{title}</span>
        <div className="flex items-center gap-3">
          <button onClick={toggleTheme} aria-label="Toggle theme"
            style={{ ...S.t4, background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href={backHref} style={S.t4} className="text-xs uppercase tracking-widest hover:opacity-80">{backLabel}</Link>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p style={S.t4} className="text-xs uppercase tracking-widest">Identity</p>
          <p style={S.t4} className="text-xs leading-relaxed">
            Your identity is a keypair in an encrypted <span style={S.t2}>.wspr</span> file. No server. No account.
          </p>

          {/* Mode tabs */}
          <div className="flex gap-1">
            {(['load', 'create'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                style={mode === m
                  ? { border: '1px solid var(--border-3)', ...S.t1 }
                  : { border: '1px solid var(--border)', ...S.t4 }}
                className="flex-1 text-xs py-2 transition-all">
                {m === 'load' ? 'Load identity' : 'Create new'}
              </button>
            ))}
          </div>

          {mode === 'load' && (<>
            <label style={pendingFile
              ? { border: '1px solid var(--border-3)', background: 'var(--bg-2)' }
              : { border: '1px solid var(--border)' }}
              className="block p-4 cursor-pointer text-center transition-all hover:opacity-80">
              <span style={S.t3} className="text-xs">{pendingFileName || 'Select .wspr file'}</span>
              <input type="file" accept=".wspr" onChange={handleFileLoad} className="hidden" />
            </label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUnlock()}
              placeholder="Password" style={inputStyle}
              className="w-full text-xs p-3 focus:outline-none" />
            {error && <p style={S.t3} className="text-xs">{error}</p>}
            <button onClick={handleUnlock} disabled={loading || !pendingFile || !password}
              style={{ border: '1px solid var(--border-3)', ...S.t1, background: 'var(--bg-2)' }}
              className="text-xs py-3 uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-80">
              {loading ? 'Unlocking...' : 'Unlock'}
            </button>
          </>)}

          {mode === 'create' && (<>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)" style={inputStyle}
              className="w-full text-xs p-3 focus:outline-none" />
            <input type="password" value={password2} onChange={e => setPassword2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Confirm password" style={inputStyle}
              className="w-full text-xs p-3 focus:outline-none" />
            {error && <p style={S.t3} className="text-xs">{error}</p>}
            <button onClick={handleCreate} disabled={loading || !password || !password2}
              style={{ border: '1px solid var(--border-3)', ...S.t1, background: 'var(--bg-2)' }}
              className="text-xs py-3 uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-80">
              {loading ? 'Creating...' : 'Create & download identity'}
            </button>
            <p style={S.t5} className="text-xs">A .wspr file will download. Keep it safe — it is your identity.</p>
          </>)}
        </div>
      </div>
    </main>
  )
}
