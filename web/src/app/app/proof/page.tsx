'use client'
import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { getSessionIdentity, type Identity } from '@/lib/identity'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'

type ProofBundle = {
  version: '2'
  id: string
  // What's being proven
  contentType: 'file' | 'text'
  fileName?: string
  fileSize?: number
  textSnippet?: string // first 120 chars of text, not the full text
  sha256: string
  // Who proved it
  signedBy: string
  signature: string
  // When
  timestamp: number
  isoCtime: string
  // Nostr anchor
  nostrEventId: string | null
  nostrRelay: string | null
}

type VerifyResult = {
  contentMatch: boolean
  signatureValid: boolean
  bundle: ProofBundle
}

type HistoryEntry = ProofBundle & { label: string }

const NOSTR_RELAYS = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol']
const HISTORY_KEY = 'wspr_proof_history'

function toAB(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function signData(data: string, privateKeyRaw: string): Promise<string> {
  const keyBytes = Uint8Array.from(atob(privateKeyRaw), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', toAB(keyBytes), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data)
  )
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

async function verifySignature(data: string, signature: string, publicKeyRaw: string): Promise<boolean> {
  try {
    const pubBytes = Uint8Array.from(atob(publicKeyRaw), c => c.charCodeAt(0))
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'raw', toAB(pubBytes), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    )
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, sigBytes, new TextEncoder().encode(data)
    )
  } catch { return false }
}

async function publishToNostr(bundle: ProofBundle, privateKeyRaw: string): Promise<{ id: string; relay: string } | null> {
  try {
    const content = JSON.stringify({
      type: 'wspr-proof-v2',
      id: bundle.id,
      sha256: bundle.sha256,
      contentType: bundle.contentType,
      ...(bundle.fileName ? { file: bundle.fileName } : {}),
      signedBy: bundle.signedBy,
      ts: bundle.timestamp
    })
    const pubBytes = Uint8Array.from(atob(bundle.signedBy), c => c.charCodeAt(0))
    const pubKeyHex = Array.from(pubBytes).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,64)
    const created_at = Math.floor(bundle.timestamp / 1000)
    const tags = [['t','wspr-proof'], ['t', bundle.contentType]]
    const eventStr = JSON.stringify([0, pubKeyHex, created_at, 1, tags, content])
    const eventId = await sha256Hex(new TextEncoder().encode(eventStr).buffer as ArrayBuffer)
    const keyBytes = Uint8Array.from(atob(privateKeyRaw), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey(
      'pkcs8', toAB(keyBytes), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(eventId))
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
    const event = { id: eventId, pubkey: pubKeyHex, created_at, kind: 1, tags, content, sig: sigHex }
    for (const url of NOSTR_RELAYS) {
      try {
        const relay = await new Promise<string>((resolve, reject) => {
          const ws = new WebSocket(url)
          const timer = setTimeout(() => { ws.close(); reject() }, 6000)
          ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]))
          ws.onmessage = (e) => {
            const d = JSON.parse(e.data)
            if (d[0] === 'OK') { clearTimeout(timer); ws.close(); resolve(url) }
          }
          ws.onerror = () => { clearTimeout(timer); reject() }
        })
        return { id: eventId, relay }
      } catch { continue }
    }
    return null
  } catch { return null }
}

function loadHistory(): HistoryEntry[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveToHistory(bundle: ProofBundle) {
  const h = loadHistory()
  const label = bundle.contentType === 'file' ? (bundle.fileName || 'file') : `text: ${bundle.textSnippet?.slice(0,40)}...`
  const entry: HistoryEntry = { ...bundle, label }
  localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...h].slice(0, 50)))
}

export default function ProofBundlePage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [identity, setIdentity] = useState<Identity | null>(() => getSessionIdentity())
  const [tab, setTab] = useState<'create' | 'verify' | 'history'>('create')

  // Create state
  const [contentType, setContentType] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [textHash, setTextHash] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [bundle, setBundle] = useState<ProofBundle | null>(null)
  const [status, setStatus] = useState<'idle' | 'hashing' | 'signing' | 'publishing' | 'done' | 'error'>('idle')
  const [log, setLog] = useState<string[]>([])

  // Verify state
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyText, setVerifyText] = useState('')
  const [verifyProofFile, setVerifyProofFile] = useState<File | null>(null)
  const [verifyProofJson, setVerifyProofJson] = useState('')
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState('')
  const [verifyContentType, setVerifyContentType] = useState<'file' | 'text'>('file')

  // History
  const [history, setHistory] = useState<HistoryEntry[]>([])

  const fileRef = useRef<HTMLInputElement>(null)
  const verifyFileRef = useRef<HTMLInputElement>(null)
  const verifyProofRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setHistory(loadHistory()) }, [tab])

  const addLog = (msg: string) => {
    const t = new Date().toTimeString().slice(0, 8)
    setLog(prev => [`[${t}] ${msg}`, ...prev].slice(0, 12))
  }

  if (!identity) return (
    <IdentityGate backHref="/app" title="wspr / proof bundle" onIdentityReady={id => setIdentity(id)} />
  )

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setFile(f); setBundle(null); setFileHash(null); setStatus('hashing')
    addLog(`Hashing ${f.name} (${(f.size/1024).toFixed(1)} KB)...`)
    const buf = await f.arrayBuffer()
    const hash = await sha256Hex(buf)
    setFileHash(hash); setStatus('idle')
    addLog(`SHA-256: ${hash.slice(0,24)}...`)
  }

  const handleTextChange = async (val: string) => {
    setText(val)
    if (!val.trim()) { setTextHash(null); return }
    const hash = await sha256Hex(new TextEncoder().encode(val).buffer as ArrayBuffer)
    setTextHash(hash)
  }

  const handleCreate = async () => {
    if (!identity) return
    const hash = contentType === 'file' ? fileHash : textHash
    if (!hash) return
    setStatus('signing'); setBundle(null)
    addLog('Signing with your wspr identity...')
    try {
      const sigPayload = `wspr-proof-v2:${hash}:${Date.now()}`
      const sig = await signData(sigPayload, identity.privateKeyRaw)
      const now = Date.now()
      const draft: ProofBundle = {
        version: '2',
        id: crypto.randomUUID(),
        contentType,
        ...(contentType === 'file' && file ? { fileName: file.name, fileSize: file.size } : {}),
        ...(contentType === 'text' ? { textSnippet: text.slice(0, 120) } : {}),
        sha256: hash,
        signedBy: identity.publicKey,
        signature: sig,
        timestamp: now,
        isoCtime: new Date(now).toISOString(),
        nostrEventId: null,
        nostrRelay: null,
      }
      setStatus('publishing')
      addLog('Anchoring to Nostr...')
      const nostr = await publishToNostr(draft, identity.privateKeyRaw)
      if (nostr) {
        draft.nostrEventId = nostr.id
        draft.nostrRelay = nostr.relay
        addLog(`⚓ Anchored on ${nostr.relay.replace('wss://','').split('/')[0]}`)
        addLog(`Event: ${nostr.id.slice(0,20)}...`)
      } else {
        addLog('Relays offline — proof valid offline only.')
      }
      setBundle(draft)
      saveToHistory(draft)
      setStatus('done')
      addLog('✓ Proof bundle ready.')
    } catch (e) {
      addLog(`✗ ${e instanceof Error ? e.message : 'Failed'}`)
      setStatus('error')
    }
  }

  const handleDownload = (b: ProofBundle) => {
    const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    const name = b.contentType === 'file' ? b.fileName?.replace(/\.[^/.]+$/, '') : `text-${b.id.slice(0,8)}`
    a.download = `${name}.proof`
    a.click(); URL.revokeObjectURL(url)
  }

  const handleVerifyProofFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return
    setVerifyProofFile(f)
    const text = await f.text()
    setVerifyProofJson(text)
    try {
      const p: ProofBundle = JSON.parse(text)
      setVerifyContentType(p.contentType)
    } catch {}
  }

  const handleVerify = async () => {
    setVerifyError(''); setVerifyResult(null)
    const proofStr = verifyProofJson.trim()
    if (!proofStr) { setVerifyError('Load a .proof file or paste JSON.'); return }
    try {
      const proof: ProofBundle = JSON.parse(proofStr)
      let hash: string
      if (proof.contentType === 'file') {
        if (!verifyFile) { setVerifyError('Select the original file to verify.'); return }
        const buf = await verifyFile.arrayBuffer()
        hash = await sha256Hex(buf)
      } else {
        if (!verifyText.trim()) { setVerifyError('Enter the original text to verify.'); return }
        hash = await sha256Hex(new TextEncoder().encode(verifyText).buffer as ArrayBuffer)
      }
      const contentMatch = hash === proof.sha256
      // v2 sig payload
      const sigPayload = proof.version === '2'
        ? `wspr-proof-v2:${proof.sha256}:${proof.timestamp}`
        : proof.sha256 // v1 fallback
      const signatureValid = await verifySignature(sigPayload, proof.signature, proof.signedBy)
      setVerifyResult({ contentMatch, signatureValid, bundle: proof })
    } catch (e) {
      setVerifyError(`Parse error: ${e instanceof Error ? e.message : 'Invalid .proof file'}`)
    }
  }

  const busy = ['hashing','signing','publishing'].includes(status)
  const canCreate = contentType === 'file' ? (!!fileHash && !busy) : (!!textHash && !busy)

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr / proof bundle</span>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href="/app" style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-4 py-8 max-w-2xl mx-auto w-full">
        {/* Tabs */}
        <div className="flex w-full mb-8" style={{ borderBottom: '1px solid var(--border)' }}>
          {(['create', 'verify', 'history'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ color: tab === t ? 'var(--text-1)' : 'var(--text-5)', borderBottom: tab === t ? '2px solid var(--text-2)' : '2px solid transparent', marginBottom: '-1px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--text-2)' : '2px solid transparent', cursor: 'pointer' }}
              className="px-4 py-2 text-xs uppercase tracking-widest">
              {t}{t === 'history' && history.length > 0 ? ` (${history.length})` : ''}
            </button>
          ))}
        </div>

        {/* CREATE */}
        {tab === 'create' && (
          <div className="w-full flex flex-col gap-5">
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">
              Notarize any file or text. SHA-256 hash + ECDSA signature + Nostr timestamp. The resulting <code>.proof</code> file is self-contained — verifiable offline, forever, by anyone.
            </p>

            {/* Content type toggle */}
            <div className="flex gap-0 w-full" style={{ border: '1px solid var(--border)' }}>
              {(['file', 'text'] as const).map(ct => (
                <button key={ct} onClick={() => { setContentType(ct); setBundle(null) }}
                  style={{ flex: 1, background: contentType === ct ? 'var(--bg-3)' : 'none', color: contentType === ct ? 'var(--text-1)' : 'var(--text-4)', border: 'none', cursor: 'pointer', borderRight: ct === 'file' ? '1px solid var(--border)' : 'none' }}
                  className="py-2 text-xs uppercase tracking-widest">
                  {ct === 'file' ? '↑ File / Document' : '✎ Text / Statement'}
                </button>
              ))}
            </div>

            {contentType === 'file' ? (
              <>
                <div onClick={() => fileRef.current?.click()}
                  style={{ border: file ? '1px solid var(--border-2)' : '1px dashed var(--border)', color: 'var(--text-4)', cursor: 'pointer', minHeight: '80px' }}
                  className="p-6 flex flex-col items-center justify-center text-center hover:opacity-80 transition-opacity">
                  {file ? (
                    <>
                      <p style={{ color: 'var(--text-2)' }} className="text-sm mb-1">{file.name}</p>
                      <p className="text-xs mb-2">{(file.size/1024).toFixed(1)} KB · {file.type || 'unknown type'}</p>
                      {fileHash && <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono break-all">{fileHash}</p>}
                    </>
                  ) : (
                    <>
                      <p className="text-xs mb-1">Drop any file here</p>
                      <p style={{ fontSize: '10px' }}>PDF, image, video, document, binary — anything</p>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={handleFileSelect} />
              </>
            ) : (
              <>
                <textarea
                  value={text}
                  onChange={e => handleTextChange(e.target.value)}
                  placeholder="Enter your statement, testimony, or any text to notarize..."
                  rows={6}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', resize: 'vertical', fontSize: '12px', padding: '12px', fontFamily: 'monospace', lineHeight: '1.6' }}
                  className="w-full focus:outline-none"
                />
                {textHash && (
                  <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono -mt-3 break-all">SHA-256: {textHash}</p>
                )}
              </>
            )}

            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional note (stored in .proof, not hashed)"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', fontSize: '12px', padding: '10px', fontFamily: 'monospace' }}
              className="w-full focus:outline-none"
            />

            <button onClick={handleCreate} disabled={!canCreate || status === 'done'}
              style={{ background: canCreate && status !== 'done' ? 'var(--text-1)' : 'var(--bg-3)', color: canCreate && status !== 'done' ? 'var(--bg)' : 'var(--text-5)', border: '1px solid var(--border)', cursor: canCreate && status !== 'done' ? 'pointer' : 'not-allowed' }}
              className="w-full py-3 text-xs uppercase tracking-widest">
              {status === 'hashing' ? '⟳ Hashing...' : status === 'signing' ? '⟳ Signing...' : status === 'publishing' ? '⟳ Anchoring to Nostr...' : status === 'done' ? '✓ Done' : 'Create Proof Bundle'}
            </button>

            {bundle && status === 'done' && (
              <div style={{ border: '1px solid var(--border-2)', background: 'var(--bg-2)' }} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p style={{ color: 'var(--text-2)' }} className="text-xs uppercase tracking-widest">Proof bundle</p>
                  <span style={{ color: bundle.nostrEventId ? '#22c55e' : 'var(--text-4)' }} className="text-xs">
                    {bundle.nostrEventId ? '⚓ Nostr anchored' : '○ Offline only'}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <Row label="Content" value={bundle.contentType === 'file' ? bundle.fileName! : `text (${bundle.textSnippet?.length} chars shown)`} />
                  <Row label="SHA-256" value={bundle.sha256} />
                  <Row label="Signed by" value={bundle.signedBy.slice(0,48) + '...'} />
                  <Row label="Timestamp" value={bundle.isoCtime} />
                  {bundle.nostrEventId && <Row label="Event ID" value={bundle.nostrEventId} />}
                  {bundle.nostrRelay && <Row label="Relay" value={bundle.nostrRelay.replace('wss://','')} />}
                  {note && <Row label="Note" value={note} />}
                </div>
                <button onClick={() => handleDownload(bundle)}
                  style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
                  className="w-full py-2 text-xs uppercase tracking-widest hover:opacity-90">
                  ↓ Download .proof file
                </button>
                <button onClick={() => { setBundle(null); setStatus('idle'); setFile(null); setFileHash(null); setText(''); setTextHash(null); setNote('') }}
                  style={{ border: '1px solid var(--border)', color: 'var(--text-4)', background: 'none', cursor: 'pointer' }}
                  className="w-full py-2 text-xs uppercase tracking-widest hover:opacity-80">
                  New proof
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

        {/* VERIFY */}
        {tab === 'verify' && (
          <div className="w-full flex flex-col gap-4">
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">
              Verify any .proof file against the original content. No network required — pure offline cryptographic verification.
            </p>

            {/* Load proof */}
            <div>
              <p style={{ color: 'var(--text-5)' }} className="text-xs mb-2 uppercase tracking-widest">Step 1 — Load .proof file</p>
              <div onClick={() => verifyProofRef.current?.click()}
                style={{ border: verifyProofFile ? '1px solid var(--border-2)' : '1px dashed var(--border)', color: 'var(--text-4)', cursor: 'pointer' }}
                className="p-4 text-center text-xs hover:opacity-80">
                {verifyProofFile
                  ? <p style={{ color: 'var(--text-2)' }}>{verifyProofFile.name}</p>
                  : <p>Click to load .proof file</p>}
              </div>
              <input ref={verifyProofRef} type="file" accept=".proof,.json" className="hidden" onChange={handleVerifyProofFile} />
              <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="mt-1">or paste JSON below</p>
              <textarea value={verifyProofJson} onChange={e => { setVerifyProofJson(e.target.value); try { const p = JSON.parse(e.target.value); setVerifyContentType(p.contentType) } catch {} }}
                placeholder="{...}"
                rows={3}
                style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-3)', resize: 'none', fontSize: '10px', padding: '8px', fontFamily: 'monospace', marginTop: '4px' }}
                className="w-full focus:outline-none mt-1"
              />
            </div>

            {/* Original content */}
            <div>
              <p style={{ color: 'var(--text-5)' }} className="text-xs mb-2 uppercase tracking-widest">
                Step 2 — Provide original {verifyContentType === 'file' ? 'file' : 'text'}
              </p>
              {verifyContentType === 'file' ? (
                <div onClick={() => verifyFileRef.current?.click()}
                  style={{ border: verifyFile ? '1px solid var(--border-2)' : '1px dashed var(--border)', color: 'var(--text-4)', cursor: 'pointer' }}
                  className="p-4 text-center text-xs hover:opacity-80">
                  {verifyFile ? <p style={{ color: 'var(--text-2)' }}>{verifyFile.name}</p> : <p>Click to select original file</p>}
                </div>
              ) : (
                <textarea value={verifyText} onChange={e => setVerifyText(e.target.value)}
                  placeholder="Paste the original text..."
                  rows={5}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-1)', resize: 'none', fontSize: '12px', padding: '10px', fontFamily: 'monospace' }}
                  className="w-full focus:outline-none"
                />
              )}
              <input ref={verifyFileRef} type="file" className="hidden" onChange={e => setVerifyFile(e.target.files?.[0] ?? null)} />
            </div>

            <button onClick={handleVerify}
              style={{ background: 'var(--text-1)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
              className="w-full py-3 text-xs uppercase tracking-widest">
              Verify
            </button>

            {verifyError && <p style={{ color: '#ef4444' }} className="text-xs">{verifyError}</p>}

            {verifyResult && (
              <div style={{ border: `1px solid ${verifyResult.contentMatch && verifyResult.signatureValid ? '#22c55e' : '#ef4444'}`, background: 'var(--bg-2)' }} className="p-4 flex flex-col gap-3">
                <p style={{ color: 'var(--text-2)' }} className="text-xs uppercase tracking-widest mb-1">Verification result</p>
                <ResultRow label="Content integrity" ok={verifyResult.contentMatch}
                  okText="Hash matches — content unmodified"
                  failText="HASH MISMATCH — content may have been altered" />
                <ResultRow label="Signature" ok={verifyResult.signatureValid}
                  okText="Valid ECDSA — signed by claimed identity"
                  failText="INVALID — signature does not match" />
                <div style={{ borderTop: '1px solid var(--border)' }} className="pt-2 flex flex-col gap-1 mt-1">
                  <Row label="Signed by" value={verifyResult.bundle.signedBy.slice(0,40) + '...'} />
                  <Row label="Timestamp" value={verifyResult.bundle.isoCtime} />
                  {verifyResult.bundle.nostrEventId && (
                    <Row label="Nostr anchor" value={verifyResult.bundle.nostrEventId.slice(0,40) + '...'} />
                  )}
                  {verifyResult.bundle.nostrRelay && (
                    <Row label="Relay" value={verifyResult.bundle.nostrRelay.replace('wss://','')} />
                  )}
                </div>
                {verifyResult.contentMatch && verifyResult.signatureValid && (
                  <div style={{ background: '#22c55e15', border: '1px solid #22c55e40' }} className="p-3 mt-1">
                    <p style={{ color: '#22c55e', fontSize: '11px' }}>
                      ✓ This content is authentic. It existed at {verifyResult.bundle.isoCtime} and has not been modified since.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* HISTORY */}
        {tab === 'history' && (
          <div className="w-full flex flex-col gap-3">
            <p style={{ color: 'var(--text-4)' }} className="text-xs">Proofs created on this device.</p>
            {history.length === 0 && (
              <p style={{ color: 'var(--text-5)' }} className="text-xs text-center mt-8">No proofs created yet.</p>
            )}
            {history.map(entry => (
              <div key={entry.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <p style={{ color: 'var(--text-2)' }} className="text-xs truncate">{entry.label}</p>
                    <p style={{ color: 'var(--text-5)', fontSize: '10px' }}>{entry.isoCtime}</p>
                    <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">
                      {entry.nostrEventId ? `⚓ ${entry.nostrEventId.slice(0,24)}...` : '○ offline'}
                    </p>
                  </div>
                  <button onClick={() => handleDownload(entry)}
                    style={{ border: '1px solid var(--border-2)', color: 'var(--text-3)', background: 'none', cursor: 'pointer', flexShrink: 0 }}
                    className="px-3 py-1 text-xs hover:opacity-80">
                    ↓
                  </button>
                </div>
              </div>
            ))}
            {history.length > 0 && (
              <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setHistory([]) }}
                style={{ border: '1px solid var(--border)', color: 'var(--text-5)', background: 'none', cursor: 'pointer' }}
                className="w-full py-2 text-xs uppercase tracking-widest mt-2 hover:opacity-80">
                Clear history
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 min-w-0">
      <span style={{ color: 'var(--text-5)', flexShrink: 0 }} className="text-xs">{label}</span>
      <span style={{ color: 'var(--text-3)', fontSize: '10px', wordBreak: 'break-all', textAlign: 'right' }} className="font-mono">{value}</span>
    </div>
  )
}

function ResultRow({ label, ok, okText, failText }: { label: string; ok: boolean; okText: string; failText: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span style={{ color: 'var(--text-5)', flexShrink: 0 }} className="text-xs">{label}</span>
      <span style={{ color: ok ? '#22c55e' : '#ef4444', fontSize: '11px', textAlign: 'right' }}>{ok ? `✓ ${okText}` : `✗ ${failText}`}</span>
    </div>
  )
}
