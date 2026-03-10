'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { encodeV2, decodeV2 } from '@/lib/stegv2'
import { encryptToBytes, decryptFromBytes, getTimeWindow } from '@/lib/crypto'
import { stripExif } from '@/lib/exif'
import { deriveSharedSecret, importPrivateKey, generateSafetyNumber, generateKeyPair, exportPrivateKey } from '@/lib/keys'
import { encryptIdentity, downloadIdentityFile } from '@/lib/identity'
import { decryptIdentity, readFileAsBytes, setSessionIdentity, getSessionIdentity, type Identity } from '@/lib/identity'
import { useTheme } from '@/lib/theme'
import { loadContacts, type Contact } from '@/lib/storage'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'

type Step = 'identity' | 'exchange' | 'ready'

const S = {
  bg:      { background: 'var(--bg)' },
  bg2:     { background: 'var(--bg-2)' },
  t1:      { color: 'var(--text-1)' },
  t2:      { color: 'var(--text-2)' },
  t3:      { color: 'var(--text-3)' },
  t4:      { color: 'var(--text-4)' },
  t5:      { color: 'var(--text-5)' },
}

const inputCls = "w-full border text-xs p-3 focus:outline-none resize-none"

export default function ToolPage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [step, setStep] = useState<Step>('identity')

  const [identity, setIdentity] = useState<Identity | null>(null)
  const [pendingFile, setPendingFile] = useState<Uint8Array | null>(null)
  const [pendingFileName, setPendingFileName] = useState('')
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlockLoading, setUnlockLoading] = useState(false)
  const [identityMode, setIdentityMode] = useState<'load' | 'create'>('load')
  const [createPassword, setCreatePassword] = useState('')
  const [createPassword2, setCreatePassword2] = useState('')
  const [createError, setCreateError] = useState('')

  const [theirPublicKey, setTheirPublicKey] = useState('')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [showContactPicker, setShowContactPicker] = useState(false)
  const [sharedSecret, setSharedSecret] = useState<Uint8Array | undefined>()
  const [safetyNumber, setSafetyNumber] = useState('')
  const [safetyVerified, setSafetyVerified] = useState(false)

  const [fileStatus, setFileStatus] = useState<'none' | 'loading' | 'ready'>('none')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })
  const [message, setMessage] = useState('')
  const [outputName, setOutputName] = useState('')
  const [decoded, setDecoded] = useState('')
  const [intact, setIntact] = useState<boolean | null>(null)
  const [decodedVisible, setDecodedVisible] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'ready' | 'processing' | 'done'>('idle')
  const [timeWindow, setTimeWindow] = useState<{ expiresIn: number } | null>(null)
  const [mobileTab, setMobileTab] = useState<'settings' | 'output'>('settings')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const update = () => setTimeWindow(getTimeWindow())
    update()
    const interval = setInterval(update, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const session = getSessionIdentity()
    if (session) { setIdentity(session); setContacts(loadContacts(session.publicKey)); setStep('exchange') }
  }, [])

  const addLog = (msg: string) => {
    const time = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10))
  }

  const clearAll = useCallback(() => {
    setFileStatus('none'); setFileName(''); setFileSize(0)
    setImageDims({ w: 0, h: 0 }); setMessage(''); setOutputName('')
    setDecoded(''); setIntact(null); setDecodedVisible(false)
    setLog([]); setStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
    const canvas = canvasRef.current
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  useEffect(() => {
    let lastEsc = 0
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const now = Date.now()
        if (now - lastEsc < 1000) clearAll()
        lastEsc = now
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [clearAll])

  useEffect(() => {
    const reset = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(clearAll, 5 * 60 * 1000)
    }
    window.addEventListener('mousemove', reset)
    window.addEventListener('keydown', reset)
    reset()
    return () => {
      window.removeEventListener('mousemove', reset)
      window.removeEventListener('keydown', reset)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [clearAll])

  const handleWsprFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(await readFileAsBytes(f))
    setPendingFileName(f.name)
  }

  const handleUnlock = async () => {
    if (!pendingFile) return setUnlockError('Select a .wspr file first.')
    if (!unlockPassword.trim()) return setUnlockError('Password required.')
    setUnlockLoading(true); setUnlockError('')
    try {
      const id = await decryptIdentity(pendingFile, unlockPassword)
      if (!id) return setUnlockError('Wrong password or invalid file.')
      setSessionIdentity(id); setIdentity(id); setStep('exchange'); addLog('Identity loaded.')
    } catch { setUnlockError('Failed to unlock.') }
    finally { setUnlockLoading(false) }
  }

  const handleCreate = async () => {
    if (!createPassword.trim()) return setCreateError('Password required.')
    if (createPassword !== createPassword2) return setCreateError('Passwords do not match.')
    if (createPassword.length < 8) return setCreateError('Min 8 characters.')
    setUnlockLoading(true); setCreateError('')
    try {
      const pair = await generateKeyPair()
      const privRaw = await exportPrivateKey(pair.privateKey)
      const id: Identity = { publicKey: pair.publicKeyRaw, privateKeyRaw: privRaw, createdAt: Date.now() }
      downloadIdentityFile(await encryptIdentity(id, createPassword), 'wspr-identity.wspr')
      setSessionIdentity(id); setIdentity(id); setStep('exchange'); addLog('Identity created.')
    } catch { setCreateError('Failed to create identity.') }
    finally { setUnlockLoading(false) }
  }

  const handleConnect = async () => {
    if (!identity || !theirPublicKey.trim()) return
    try {
      addLog('Deriving shared secret...')
      const privateKey = await importPrivateKey(identity.privateKeyRaw)
      const secret = await deriveSharedSecret(privateKey, theirPublicKey.trim())
      const safety = await generateSafetyNumber(identity.publicKey, theirPublicKey.trim())
      setSharedSecret(secret); setSafetyNumber(safety)
      addLog('Connection established. Verify safety number.')
    } catch { addLog('ERROR: Invalid public key.') }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileStatus('loading'); setDecoded(''); setIntact(null)
    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = img.width; canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      setFileName(f.name); setFileSize(f.size)
      setImageDims({ w: img.width, h: img.height })
      setOutputName(f.name.replace(/\.[^.]+$/, ''))
      setFileStatus('ready'); setStatus('ready')
      addLog(`Loaded: ${f.name} — ${img.width}x${img.height}`)
    }
    img.onerror = () => { setFileStatus('none'); addLog('ERROR: Failed to load image.') }
    img.src = URL.createObjectURL(f)
  }

  const getKey = () => safetyNumber
  const getScatterKey = (): Uint8Array => sharedSecret!

  const handleEncode = async () => {
    if (!message.trim()) return addLog('ERROR: No payload.')
    if (!sharedSecret || !safetyNumber) return addLog('ERROR: No connection.')
    if (!safetyVerified) return addLog('ERROR: Verify safety number first.')
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    setStatus('processing'); addLog('Encrypting...')
    try {
      const cipherBytes = await encryptToBytes(message.trim(), getKey(), undefined, sharedSecret)
      addLog('Encoding...')
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      ctx.putImageData(encodeV2(imageData, cipherBytes, getScatterKey()), 0, 0)
      addLog('Stripping metadata...')
      const blob = await stripExif(canvas)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (outputName.trim() || 'image') + '.png'
      a.click()
      setMessage(''); addLog(`Saved. Window: ${timeWindow?.expiresIn ?? '?'}m`); setStatus('done')
    } catch (e: unknown) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown'}`); setStatus('ready')
    }
  }

  const handleDecode = async () => {
    if (!sharedSecret || !safetyNumber) return addLog('ERROR: No connection.')
    const canvas = canvasRef.current
    if (!canvas || fileStatus !== 'ready') return addLog('ERROR: No image loaded.')
    setStatus('processing'); addLog('Extracting hidden data...')
    // Yield to browser before heavy sync work so UI can update
    await new Promise(r => setTimeout(r, 30))
    try {
      const ctx = canvas.getContext('2d')!
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      // decodeV2 is sync+heavy — yield after so browser doesn't freeze
      const cipherBytes = await new Promise<Uint8Array | null>(resolve => {
        setTimeout(() => resolve(decodeV2(imageData, getScatterKey())), 0)
      })
      if (!cipherBytes || cipherBytes.length < 29) {
        addLog('No hidden data found.'); setStatus('ready'); return
      }
      addLog(`Found ${cipherBytes.length} bytes — decrypting...`)
      // Yield again before heavy PBKDF2
      await new Promise(r => setTimeout(r, 30))
      const result = await decryptFromBytes(cipherBytes, getKey(), undefined, sharedSecret)
      if (result && result.message.trim().length > 0) {
        setDecoded(result.message); setIntact(result.intact); setDecodedVisible(true)
        setTimeout(() => setDecodedVisible(false), 30000)
        setMobileTab('output')
        addLog(result.intact ? 'Done. Integrity verified.' : 'Done. WARNING: Integrity check failed.')
        setStatus('done'); return
      }
      addLog('No data found — wrong key or no message.'); setStatus('ready')
    } catch { addLog('No data found.'); setStatus('ready') }
  }

  const isEncodeMode = message.trim().length > 0
  const capacity = Math.floor((imageDims.w * imageDims.h) / 8)
  const capacityUsed = capacity > 0 ? Math.min(100, (message.length / capacity) * 100) : 0

  const ThemeBtn = () => (
    <button onClick={toggleTheme} aria-label="Toggle theme"
      style={{ ...S.t4, background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )

  const PageShell = ({ children }: { children: React.ReactNode }) => (
    <main style={{ ...S.bg, ...S.t1, fontFamily: 'monospace', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', ...S.bg }} className="px-4 py-3 flex items-center justify-between">
        <span style={S.t3} className="text-xs tracking-widest uppercase">wspr / tool</span>
        <div className="flex items-center gap-3">
          <ThemeBtn />
          <Link href="/app" style={S.t4} className="text-xs transition-all uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>
      {children}
    </main>
  )

  if (step === 'identity') return (
    <IdentityGate
      backHref="/app"
      title="wspr / tool"
      onIdentityReady={(id) => { setIdentity(id); setContacts(loadContacts(id.publicKey)); setStep('exchange') }}
    />
  )

  if (step === 'exchange' && !safetyNumber) return (
    <PageShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-4">
          <p style={S.t4} className="text-xs uppercase tracking-widest">Key Exchange</p>
          <p style={S.t4} className="text-xs leading-relaxed">Share your public key. Enter theirs to establish a connection.</p>
          <div>
            <p style={S.t4} className="text-xs mb-2">Your public key:</p>
            <div style={{ ...S.bg2, border: '1px solid var(--border)' }} className="p-3 mb-2">
              <p style={S.t3} className="text-xs break-all leading-relaxed">{identity?.publicKey}</p>
            </div>
            <button onClick={() => navigator.clipboard.writeText(identity?.publicKey || '')}
              style={{ ...S.t4, border: '1px solid var(--border)' }}
              className="w-full text-xs py-2 transition-all hover:opacity-80">Copy public key</button>
          </div>
          <div>
            <p style={S.t4} className="text-xs mb-2">Their public key:</p>
            {contacts.length > 0 && (
              <div className="mb-2">
                <button
                  onClick={() => setShowContactPicker(p => !p)}
                  style={{ ...S.t4, border: '1px solid var(--border)', background: 'none', cursor: 'pointer', width: '100%' }}
                  className="text-xs py-2 text-left px-3 hover:opacity-80">
                  {showContactPicker ? '▲ Hide contacts' : `▼ Choose from contacts (${contacts.length})`}
                </button>
                {showContactPicker && (
                  <div style={{ border: '1px solid var(--border)', borderTop: 'none', background: 'var(--bg-2)', maxHeight: '160px', overflowY: 'auto' }}>
                    {contacts.map(c => (
                      <button key={c.id}
                        onClick={() => { setTheirPublicKey(c.publicKey); setShowContactPicker(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-2)' }}
                        className="px-3 py-2 text-xs hover:opacity-70">
                        <span>{c.name}</span>
                        <span style={{ color: 'var(--text-5)', marginLeft: '8px' }}>{c.publicKey.slice(0,24)}...</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <textarea value={theirPublicKey} onChange={e => setTheirPublicKey(e.target.value)}
              placeholder="Paste their public key or choose from contacts above..." autoComplete="off" spellCheck={false}
              style={{ ...S.bg2, border: '1px solid var(--border)', ...S.t1 }} className={`${inputCls} h-20`} />
          </div>
          <button onClick={handleConnect} disabled={!theirPublicKey.trim()}
            style={{ border: '1px solid var(--border-3)', ...S.t2 }}
            className="text-xs py-3 uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-80">Connect</button>
        </div>
      </div>
    </PageShell>
  )

  if (safetyNumber && !safetyVerified) return (
    <PageShell>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <p style={S.t4} className="text-xs uppercase tracking-widest">Verify Safety Number</p>
          <p style={S.t4} className="text-xs leading-relaxed">This number must match on both devices. Verify via a separate channel.</p>
          <div style={{ ...S.bg2, border: '1px solid var(--border)' }} className="p-6">
            <p style={S.t1} className="text-xl tracking-widest font-mono text-center leading-relaxed">{safetyNumber}</p>
          </div>
          <div className="flex flex-col gap-2">
            <p style={S.t4} className="text-xs text-center">Does this match your contact&apos;s safety number?</p>
            <button onClick={() => { setSafetyVerified(true); setStep('ready'); addLog('Safety number verified.') }}
              style={{ border: '1px solid var(--border-3)', ...S.t1 }}
              className="text-xs py-3 uppercase tracking-widest transition-all hover:opacity-80">Yes — numbers match</button>
            <button onClick={() => { setTheirPublicKey(''); setSharedSecret(undefined); setSafetyNumber('') }}
              style={{ border: '1px solid var(--border)', ...S.t4 }}
              className="text-xs py-3 uppercase tracking-widest transition-all hover:opacity-80">No — start over</button>
          </div>
          <p style={S.t5} className="text-xs text-center">If numbers don&apos;t match, someone may be intercepting your connection.</p>
        </div>
      </div>
    </PageShell>
  )

  const LeftPanel = (
    <div className="flex flex-col">
      <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4">
        <p style={S.t4} className="text-xs uppercase tracking-widest mb-2">Connection</p>
        <div className="flex items-center gap-2 mb-2">
          <div style={{ background: 'var(--text-3)', width: 8, height: 8, borderRadius: '50%' }} />
          <span style={S.t2} className="text-xs">Verified — {safetyNumber.slice(0, 10)}...</span>
        </div>
        <p style={S.t4} className="text-xs">{theirPublicKey.slice(0, 32)}...</p>
        <button onClick={() => { setSafetyVerified(false); setSafetyNumber(''); setSharedSecret(undefined); setTheirPublicKey(''); setStep('exchange') }}
          style={{ ...S.t4, border: '1px solid var(--border)' }}
          className="mt-2 text-xs px-3 py-1 transition-all hover:opacity-80">Disconnect</button>
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4">
        <p style={S.t4} className="text-xs uppercase tracking-widest mb-2">Input Image</p>
        <label style={fileStatus === 'ready'
          ? { border: '1px solid var(--border-3)', background: 'var(--bg-2)' }
          : { border: '1px solid var(--border)' }}
          className="block p-4 cursor-pointer transition-all text-center">
          {fileStatus === 'none' && <span style={S.t4} className="text-xs">Select PNG file</span>}
          {fileStatus === 'loading' && <span style={S.t3} className="text-xs">Loading...</span>}
          {fileStatus === 'ready' && (
            <div>
              <span style={S.t2} className="text-xs block truncate">{fileName}</span>
              <span style={S.t4} className="text-xs">{imageDims.w}x{imageDims.h} — {(fileSize / 1024).toFixed(1)} KB</span>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="image/png" onChange={handleFile} className="hidden" />
        </label>
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4">
        <p style={S.t4} className="text-xs uppercase tracking-widest mb-2">
          Payload <span style={S.t5} className="normal-case">(leave empty to decode)</span>
        </p>
        <textarea value={message} onChange={e => setMessage(e.target.value)}
          placeholder="Type to encode. Leave empty to decode."
          autoComplete="off" spellCheck={false}
          style={{ ...S.bg2, border: '1px solid var(--border)', ...S.t1 }}
          className={`${inputCls} h-28`} />
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="p-4">
        <p style={S.t4} className="text-xs uppercase tracking-widest mb-2">Output Filename</p>
        <div className="flex items-center gap-1">
          <input type="text" value={outputName} onChange={e => setOutputName(e.target.value)} autoComplete="off"
            style={{ ...S.bg2, border: '1px solid var(--border)', ...S.t1 }} className={`${inputCls} flex-1`} />
          <span style={S.t4} className="text-xs">.png</span>
        </div>
      </div>
      <div className="p-4 flex gap-2">
        <button onClick={handleDecode} disabled={status === 'processing' || fileStatus !== 'ready'}
          style={{ border: '1px solid var(--border-2)', ...S.t3 }}
          className="flex-1 py-3 text-xs uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-80">Decode</button>
        <button onClick={handleEncode} disabled={status === 'processing' || !isEncodeMode || fileStatus !== 'ready'}
          style={{ border: '1px solid var(--border-3)', ...S.t1 }}
          className="flex-1 py-3 text-xs uppercase tracking-widest transition-all disabled:opacity-30 hover:opacity-80">
          {status === 'processing' ? 'Working...' : 'Encode'}
        </button>
      </div>
    </div>
  )

  const RightPanel = (
    <div className="flex flex-col h-full">
      <div style={{ borderBottom: '1px solid var(--border)' }} className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <p style={S.t4} className="text-xs uppercase tracking-widest">Output</p>
          {decoded && (
            <button onMouseDown={() => setDecodedVisible(true)} onMouseUp={() => setDecodedVisible(false)}
              onTouchStart={() => setDecodedVisible(true)} onTouchEnd={() => setDecodedVisible(false)}
              style={{ ...S.t4, border: '1px solid var(--border)' }} className="text-xs px-2 py-1 select-none hover:opacity-80">
              hold to reveal
            </button>
          )}
        </div>
        {decoded ? (
          <div style={intact === false
            ? { border: '1px solid #7f1d1d', background: 'var(--bg-2)' }
            : { border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-4">
            {intact !== null && (
              <p style={{ color: intact ? 'var(--text-4)' : '#991b1b' }} className="text-xs mb-3 uppercase tracking-widest">
                {intact ? 'integrity verified' : 'warning: possible tampering'}
              </p>
            )}
            <p style={S.t1} className={`text-xs leading-relaxed whitespace-pre-wrap break-words transition-all duration-500 select-none ${decodedVisible ? '' : 'blur-md'}`}>
              {decoded}
            </p>
            {!decodedVisible && <p style={S.t4} className="text-xs text-center mt-3 select-none">Hold to reveal</p>}
          </div>
        ) : (
          <p style={S.t5} className="text-xs">—</p>
        )}
      </div>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="px-6 py-3">
        <div className="flex justify-between text-xs mb-1">
          <span style={S.t4}>Capacity</span>
          <span style={S.t4}>{message.length} / ~{capacity} chars{fileStatus !== 'ready' && ' (load image)'}</span>
        </div>
        <div style={{ background: 'var(--bg-3)', height: 1 }}>
          <div style={{ width: `${capacityUsed}%`, height: 1, background: capacityUsed > 90 ? '#991b1b' : 'var(--text-4)', transition: 'width 0.2s' }} />
        </div>
      </div>
      <div className="p-4 overflow-y-auto" style={{ maxHeight: '12rem' }}>
        <p style={S.t4} className="text-xs uppercase tracking-widest mb-2">Log</p>
        {log.length === 0 && <p style={S.t5} className="text-xs">Awaiting input.</p>}
        {log.map((entry, i) => (
          <p key={i} style={{ color: entry.includes('ERROR') || entry.includes('WARNING') ? 'var(--text-3)' : 'var(--text-4)' }} className="text-xs mb-1">{entry}</p>
        ))}
      </div>
    </div>
  )

  return (
    <main style={{ ...S.bg, ...S.t1, fontFamily: 'monospace', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)', ...S.bg }} className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: status === 'processing' ? '#eab308' : status === 'done' ? 'var(--text-3)' : 'var(--text-5)' }} />
          <span style={S.t3} className="text-xs tracking-widest uppercase">wspr / tool</span>
        </div>
        <div className="flex items-center gap-3">
          {timeWindow && (
            <span style={{ color: timeWindow.expiresIn <= 10 ? 'var(--text-3)' : 'var(--text-5)' }} className="text-xs hidden sm:inline">
              {timeWindow.expiresIn}m
            </span>
          )}
          <ThemeBtn />
          <Link href="/app" style={S.t4} className="text-xs transition-all uppercase tracking-widest hover:opacity-80">← back</Link>
          <button onClick={clearAll} style={{ ...S.t4, border: '1px solid var(--border)' }}
            className="text-xs px-3 py-1 transition-all hover:opacity-80">CLEAR</button>
        </div>
      </div>
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div style={{ borderRight: '1px solid var(--border)', width: 384, flexShrink: 0, overflowY: 'auto' }}>{LeftPanel}</div>
        <div className="flex-1 flex flex-col min-w-0">{RightPanel}</div>
      </div>
      <div className="flex md:hidden flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">{mobileTab === 'settings' ? LeftPanel : RightPanel}</div>
        <div style={{ borderTop: '1px solid var(--border)' }} className="flex">
          {(['settings', 'output'] as const).map(tab => (
            <button key={tab} onClick={() => setMobileTab(tab)}
              style={mobileTab === tab ? { ...S.t1, borderTop: '1px solid var(--border-3)', marginTop: -1 } : S.t4}
              className="flex-1 py-3 text-xs uppercase tracking-widest transition-all relative">
              {tab}
              {tab === 'output' && decoded && mobileTab !== 'output' && (
                <span style={{ background: 'var(--text-3)', position: 'absolute', top: 8, right: 24, width: 6, height: 6, borderRadius: '50%' }} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div style={{ borderTop: '1px solid var(--border)' }} className="hidden md:flex px-6 py-2 items-center justify-between">
        <span style={S.t4} className="text-xs">
          {status === 'idle' && 'Ready'}{status === 'ready' && 'Loaded'}
          {status === 'processing' && 'Processing...'}{status === 'done' && 'Done'}
        </span>
        <span style={S.t5} className="text-xs">AES-256-GCM / ECDH / LSB-hardened</span>
      </div>
      <canvas ref={canvasRef} className="hidden" />
    </main>
  )
}
