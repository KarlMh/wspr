'use client'
import { useState, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { getSessionIdentity, type Identity } from '@/lib/identity'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'

type ProofBundle = {
  version: '1'
  fileName: string
  fileSize: number
  sha256: string
  signedBy: string
  signature: string
  nostrEventId: string | null
  timestamp: number
  isoCtime: string
}

type VerifyResult = {
  fileMatch: boolean
  signatureValid: boolean
  timestamp: number
  isoCtime: string
  signedBy: string
  nostrEventId: string | null
}

const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
]

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function signHash(hexHash: string, privateKeyRaw: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(privateKeyRaw), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  )
  const enc = new TextEncoder()
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(hexHash))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function verifySignature(hexHash: string, signature: string, publicKeyRaw: string): Promise<boolean> {
  try {
    const pubBytes = Uint8Array.from(atob(publicKeyRaw), c => c.charCodeAt(0))
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'raw', pubBytes.buffer.slice(pubBytes.byteOffset, pubBytes.byteOffset + pubBytes.byteLength) as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
    const enc = new TextEncoder()
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, enc.encode(hexHash))
  } catch { return false }
}

async function publishToNostr(bundle: Omit<ProofBundle, 'nostrEventId'>, privateKeyRaw: string): Promise<string | null> {
  try {
    // Build a minimal Nostr event (kind 1) with the proof as content
    const content = JSON.stringify({ type: 'wspr-proof', sha256: bundle.sha256, file: bundle.fileName, signedBy: bundle.signedBy })
    const pubKeyBytes = Uint8Array.from(atob(bundle.signedBy), c => c.charCodeAt(0))
    const pubKeyHex = Array.from(pubKeyBytes).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,64)
    const event = { kind: 1, created_at: Math.floor(bundle.timestamp / 1000), tags: [['t','wspr-proof']], content, pubkey: pubKeyHex }
    const eventStr = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const eventHash = await sha256Hex(new TextEncoder().encode(eventStr).buffer as ArrayBuffer)

    // Sign the event id
    const keyBytes = Uint8Array.from(atob(privateKeyRaw), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'pkcs8', keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(eventHash))
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
    const signedEvent = { ...event, id: eventHash, sig: sigHex }

    // Publish to first available relay
    for (const url of NOSTR_RELAYS) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url)
          const timer = setTimeout(() => { ws.close(); reject() }, 5000)
          ws.onopen = () => ws.send(JSON.stringify(['EVENT', signedEvent]))
          ws.onmessage = (e) => {
            const data = JSON.parse(e.data)
            if (data[0] === 'OK') { clearTimeout(timer); ws.close(); resolve() }
          }
          ws.onerror = () => { clearTimeout(timer); reject() }
        })
        return eventHash
      } catch { continue }
    }
    return null
  } catch { return null }
}

export default function ProofBundlePage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [identity, setIdentity] = useState<Identity | null>(() => getSessionIdentity())
  const [file, setFile] = useState<File | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [bundle, setBundle] = useState<ProofBundle | null>(null)
  const [status, setStatus] = useState<'idle' | 'hashing' | 'signing' | 'publishing' | 'done' | 'error'>('idle')
  const [log, setLog] = useState<string[]>([])
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyProof, setVerifyProof] = useState<string>('')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState('')
  const [tab, setTab] = useState<'create' | 'verify'>('create')
  const fileRef = useRef<HTMLInputElement>(null)
  const verifyFileRef = useRef<HTMLInputElement>(null)

  const addLog = (msg: string) => {
    const t = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${t}] ${msg}`, ...prev].slice(0, 10))
  }

  if (!identity) return (
    <IdentityGate backHref="/app" title="wspr / proof bundle" onIdentityReady={id => setIdentity(id)} />
  )

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setFile(f); setBundle(null); setFileHash(null); setStatus('hashing')
    addLog(`Reading ${f.name} (${(f.size / 1024).toFixed(1)} KB)...`)
    const buf = await f.arrayBuffer()
    const hash = await sha256Hex(buf)
    setFileHash(hash)
    setStatus('idle')
    addLog(`SHA-256: ${hash.slice(0, 16)}...`)
  }

  const handleCreate = async () => {
    if (!file || !fileHash || !identity) return
    setStatus('signing')
    addLog('Signing hash with your keypair...')
    try {
      const sig = await signHash(fileHash, identity.privateKeyRaw)
      const now = Date.now()
      const draft: Omit<ProofBundle, 'nostrEventId'> = {
        version: '1',
        fileName: file.name,
        fileSize: file.size,
        sha256: fileHash,
        signedBy: identity.publicKey,
        signature: sig,
        timestamp: now,
        isoCtime: new Date(now).toISOString(),
      }
      setStatus('publishing')
      addLog('Publishing hash to Nostr relay...')
      const eventId = await publishToNostr(draft, identity.privateKeyRaw)
      if (eventId) addLog(`Published. Event: ${eventId.slice(0, 16)}...`)
      else addLog('Relay publish failed — proof still valid offline.')
      const final: ProofBundle = { ...draft, nostrEventId: eventId }
      setBundle(final)
      setStatus('done')
      addLog('Proof bundle ready.')
    } catch (e) {
      addLog(`ERROR: ${e instanceof Error ? e.message : 'Unknown error'}`)
      setStatus('error')
    }
  }

  const handleDownload = () => {
    if (!bundle) return
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `${bundle.fileName.replace(/\.[^/.]+$/, '')}.proof`
    a.click(); URL.revokeObjectURL(url)
  }

  const handleVerify = async () => {
    setVerifyError(''); setVerifyResult(null)
    if (!verifyFile) { setVerifyError('Select the original file.'); return }
    if (!verifyProof.trim()) { setVerifyError('Paste the .proof JSON.'); return }
    try {
      const proof: ProofBundle = JSON.parse(verifyProof)
      const buf = await verifyFile.arrayBuffer()
      const hash = await sha256Hex(buf)
      const fileMatch = hash === proof.sha256
      const signatureValid = await verifySignature(proof.sha256, proof.signature, proof.signedBy)
      setVerifyResult({ fileMatch, signatureValid, timestamp: proof.timestamp, isoCtime: proof.isoCtime, signedBy: proof.signedBy, nostrEventId: proof.nostrEventId })
    } catch { setVerifyError('Invalid .proof file — could not parse.') }
  }

  const busy = status === 'hashing' || status === 'signing' || status === 'publishing'

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr / proof bundle</span>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href="/app" style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 py-10 max-w-2xl mx-auto w-full">
        {/* Tabs */}
        <div className="flex w-full mb-8 gap-0" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['create', 'verify'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ color: tab === t ? 'var(--text-1)' : 'var(--text-4)', borderBottom: tab === t ? '1px solid var(--text-1)' : '1px solid transparent', marginBottom: '-1px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--text-2)' : '2px solid transparent' }}
              className="px-4 py-2 text-xs uppercase tracking-widest cursor-pointer">
              {t}
            </button>
          ))}
        </div>

        {tab === 'create' && (
          <div className="w-full flex flex-col gap-4">
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">
              Hash any file, sign it with your wspr identity, and publish the proof to Nostr. Generates a <code>.proof</code> file anyone can verify offline — no server, no account, pure cryptography.
            </p>

            {/* File drop */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: '1px dashed var(--border-2)', color: 'var(--text-4)', cursor: 'pointer' }}
              className="p-8 text-center text-xs hover:opacity-80 transition-opacity">
              {file ? (
                <div>
                  <p style={{ color: 'var(--text-2)' }} className="text-sm">{file.name}</p>
                  <p className="mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                  {fileHash && <p className="mt-2 font-mono" style={{ color: 'var(--text-5)', fontSize: '10px' }}>SHA-256: {fileHash.slice(0,32)}...</p>}
                </div>
              ) : (
                <p>Click to select any file</p>
              )}
            </div>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />

            <button
              onClick={handleCreate}
              disabled={!file || !fileHash || busy || status === 'done'}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: (!file || !fileHash || busy || status === 'done') ? 'not-allowed' : 'pointer', opacity: (!file || !fileHash || busy || status === 'done') ? 0.4 : 1 }}
              className="w-full py-3 text-xs uppercase tracking-widest">
              {status === 'hashing' ? 'Hashing...' : status === 'signing' ? 'Signing...' : status === 'publishing' ? 'Publishing to Nostr...' : status === 'done' ? 'Done' : 'Create Proof Bundle'}
            </button>

            {bundle && status === 'done' && (
              <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-4 flex flex-col gap-3">
                <p style={{ color: 'var(--text-2)' }} className="text-xs uppercase tracking-widest">Proof ready</p>
                <div className="flex flex-col gap-1">
                  <Row label="File" value={bundle.fileName} />
                  <Row label="SHA-256" value={`${bundle.sha256.slice(0,24)}...`} />
                  <Row label="Signed by" value={`${bundle.signedBy.slice(0,24)}...`} />
                  <Row label="Timestamp" value={bundle.isoCtime} />
                  <Row label="Nostr event" value={bundle.nostrEventId ? `${bundle.nostrEventId.slice(0,24)}...` : 'offline only'} />
                </div>
                <button onClick={handleDownload}
                  style={{ border: '1px solid var(--border-2)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
                  className="py-2 text-xs uppercase tracking-widest hover:opacity-80">
                  ↓ Download .proof file
                </button>
              </div>
            )}

            {log.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)' }} className="pt-3 flex flex-col gap-1">
                {log.map((l, i) => <p key={i} style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">{l}</p>)}
              </div>
            )}
          </div>
        )}

        {tab === 'verify' && (
          <div className="w-full flex flex-col gap-4">
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">
              Verify a .proof file against the original document. No network needed — pure offline cryptographic verification.
            </p>

            <div onClick={() => verifyFileRef.current?.click()}
              style={{ border: '1px dashed var(--border-2)', color: 'var(--text-4)', cursor: 'pointer' }}
              className="p-6 text-center text-xs hover:opacity-80">
              {verifyFile ? <p style={{ color: 'var(--text-2)' }}>{verifyFile.name}</p> : <p>Click to select original file</p>}
            </div>
            <input ref={verifyFileRef} type="file" className="hidden" onChange={e => setVerifyFile(e.target.files?.[0] ?? null)} />

            <textarea
              value={verifyProof}
              onChange={e => setVerifyProof(e.target.value)}
              placeholder="Paste .proof JSON here..."
              rows={6}
              style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', resize: 'none', fontSize: '11px', padding: '10px', fontFamily: 'monospace' }}
              className="w-full focus:outline-none"
            />

            <button onClick={handleVerify}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
              className="w-full py-3 text-xs uppercase tracking-widest">
              Verify
            </button>

            {verifyError && <p style={{ color: '#ef4444' }} className="text-xs">{verifyError}</p>}

            {verifyResult && (
              <div style={{ border: `1px solid ${verifyResult.fileMatch && verifyResult.signatureValid ? 'var(--border-2)' : '#ef4444'}`, background: 'var(--bg-2)' }} className="p-4 flex flex-col gap-2">
                <ResultRow label="File integrity" ok={verifyResult.fileMatch} okText="Hash matches — file unmodified" failText="HASH MISMATCH — file may have been altered" />
                <ResultRow label="Signature" ok={verifyResult.signatureValid} okText="Valid — signed by claimed identity" failText="INVALID — signature does not match" />
                <Row label="Timestamp" value={verifyResult.isoCtime} />
                <Row label="Signed by" value={`${verifyResult.signedBy.slice(0,24)}...`} />
                {verifyResult.nostrEventId && <Row label="Nostr event" value={`${verifyResult.nostrEventId.slice(0,24)}...`} />}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: 'var(--text-5)' }} className="text-xs">{label}</span>
      <span style={{ color: 'var(--text-3)', fontSize: '11px' }} className="font-mono text-right break-all">{value}</span>
    </div>
  )
}

function ResultRow({ label, ok, okText, failText }: { label: string; ok: boolean; okText: string; failText: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: 'var(--text-5)' }} className="text-xs">{label}</span>
      <span style={{ color: ok ? '#22c55e' : '#ef4444', fontSize: '11px' }}>{ok ? `✓ ${okText}` : `✗ ${failText}`}</span>
    </div>
  )
}
