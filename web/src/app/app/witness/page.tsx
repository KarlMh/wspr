'use client'
import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { getSessionIdentity, type Identity } from '@/lib/identity'
import IdentityGate from '@/components/IdentityGate'
import Link from 'next/link'

type WitnessRecord = {
  id: string
  type: 'photo' | 'video' | 'audio'
  fileName: string
  sha256: string
  nostrEventId: string | null
  timestamp: number
  isoCtime: string
  encryptedKey: string // AES key encrypted with identity pubkey — only you can decrypt
  encryptedData: string // base64 AES-GCM encrypted file
}

const NOSTR_RELAYS = ['wss://relay.damus.io', 'wss://relay.nostr.band', 'wss://nos.lol']
const STORAGE_KEY = 'wspr_witness_records'

function loadRecords(): WitnessRecord[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveRecord(r: WitnessRecord) {
  const all = loadRecords()
  localStorage.setItem(STORAGE_KEY, JSON.stringify([r, ...all].slice(0, 100)))
}
function deleteRecord(id: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadRecords().filter(r => r.id !== id)))
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('')
}

function toAB(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}

async function encryptFile(bytes: Uint8Array, pubKeyB64: string): Promise<{ encryptedData: string; encryptedKey: string }> {
  // Generate random AES key
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, toAB(bytes))
  const combined = new Uint8Array(12 + encrypted.byteLength)
  combined.set(iv); combined.set(new Uint8Array(encrypted), 12)

  // Encrypt AES key with ECDH ephemeral
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey)
  const pubBytes = Uint8Array.from(atob(pubKeyB64), c => c.charCodeAt(0))
  const pubKey = await crypto.subtle.importKey('raw', toAB(pubBytes), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pubKey }, ephemeral.privateKey, 256)
  const wrapKey = await crypto.subtle.importKey('raw', sharedBits, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv2 = crypto.getRandomValues(new Uint8Array(12))
  const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv2 }, wrapKey, rawAesKey)
  const ephPub = await crypto.subtle.exportKey('raw', ephemeral.publicKey)
  const keyBundle = new Uint8Array(65 + 12 + wrappedKey.byteLength)
  keyBundle.set(new Uint8Array(ephPub), 0)
  keyBundle.set(iv2, 65)
  keyBundle.set(new Uint8Array(wrappedKey), 77)

  return {
    encryptedData: btoa(String.fromCharCode(...combined)),
    encryptedKey: btoa(String.fromCharCode(...keyBundle))
  }
}

async function decryptFile(encryptedData: string, encryptedKey: string, privKeyB64: string): Promise<Uint8Array> {
  const keyBundle = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0))
  const ephPubRaw = keyBundle.slice(0, 65)
  const iv2 = keyBundle.slice(65, 77)
  const wrappedKey = keyBundle.slice(77)

  const privBytes = Uint8Array.from(atob(privKeyB64), c => c.charCodeAt(0))
  const privKey = await crypto.subtle.importKey('pkcs8', toAB(privBytes), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const ephPub = await crypto.subtle.importKey('raw', toAB(ephPubRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephPub }, privKey, 256)
  const wrapKey = await crypto.subtle.importKey('raw', sharedBits, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  const rawAesKey = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv2 }, wrapKey, toAB(wrappedKey))
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])

  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ct = combined.slice(12)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, toAB(ct))
  return new Uint8Array(plain)
}

async function publishHashToNostr(sha256: string, type: string, privKeyB64: string, pubKeyB64: string): Promise<string | null> {
  try {
    const content = JSON.stringify({ type: 'wspr-witness', sha256, mediaType: type, ts: Date.now() })
    const pubBytes = Uint8Array.from(atob(pubKeyB64), c => c.charCodeAt(0))
    const pubKeyHex = Array.from(pubBytes).map(b => b.toString(16).padStart(2,'0')).join('').slice(0,64)
    const created_at = Math.floor(Date.now() / 1000)
    const eventStr = JSON.stringify([0, pubKeyHex, created_at, 1, [['t','wspr-witness']], content])
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventStr))
    const eventId = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('')
    const privBytes = Uint8Array.from(atob(privKeyB64), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('pkcs8', toAB(privBytes), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(eventId))
    const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('')
    const event = { id: eventId, pubkey: pubKeyHex, created_at, kind: 1, tags: [['t','wspr-witness']], content, sig: sigHex }
    for (const url of NOSTR_RELAYS) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url)
          const t = setTimeout(() => { ws.close(); reject() }, 5000)
          ws.onopen = () => ws.send(JSON.stringify(['EVENT', event]))
          ws.onmessage = (e) => { const d = JSON.parse(e.data); if (d[0]==='OK') { clearTimeout(t); ws.close(); resolve() } }
          ws.onerror = () => { clearTimeout(t); reject() }
        })
        return eventId
      } catch { continue }
    }
    return null
  } catch { return null }
}

export default function SilentWitnessPage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [identity, setIdentity] = useState<Identity | null>(() => getSessionIdentity())
  const [records, setRecords] = useState<WitnessRecord[]>([])
  const [status, setStatus] = useState<'idle' | 'encrypting' | 'publishing' | 'done' | 'error'>('idle')
  const [log, setLog] = useState<string[]>([])
  const [decrypting, setDecrypting] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [recording, setRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const chunksRef = useRef<Blob[]>([])

  useEffect(() => { setRecords(loadRecords()) }, [])

  const addLog = (msg: string) => {
    const t = new Date().toTimeString().slice(0,8)
    setLog(prev => [`[${t}] ${msg}`, ...prev].slice(0,10))
  }

  if (!identity) return (
    <IdentityGate backHref="/app" title="wspr / silent witness" onIdentityReady={id => setIdentity(id)} />
  )

  const handleCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f || !identity) return
    await processFile(f)
    e.target.value = ''
  }

  const guessMime = (record: WitnessRecord) => {
    const ext = record.fileName.split('.').pop()?.toLowerCase()
    if (record.type === 'video') return ext === 'webm' ? 'video/webm' : 'video/mp4'
    if (record.type === 'audio') return ext === 'mp4' ? 'audio/mp4' : 'audio/webm'
    if (ext === 'png') return 'image/png'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'webp') return 'image/webp'
    return 'image/jpeg'
  }
  const handleDecrypt = async (record: WitnessRecord) => {
    if (!identity) return
    setDecrypting(record.id)
    try {
      const bytes = await decryptFile(record.encryptedData, record.encryptedKey, identity.privateKeyRaw)
      const mime = guessMime(record)
      const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = record.fileName; a.click()
      URL.revokeObjectURL(url)
    } catch { addLog('Decrypt failed.') }
    setDecrypting(null)
  }

  const startCamera = async (mode: 'photo' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: mode === 'video' })
      setCameraStream(stream); setCameraActive(true)
      setTimeout(() => { if (videoPreviewRef.current) { videoPreviewRef.current.srcObject = stream; videoPreviewRef.current.play() } }, 50)
    } catch { addLog('Camera access denied.') }
  }

  const stopCamera = () => {
    cameraStream?.getTracks().forEach(t => t.stop())
    setCameraStream(null); setCameraActive(false); setRecording(false)
  }

  const capturePhoto = async () => {
    if (!videoPreviewRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoPreviewRef.current.videoWidth
    canvas.height = videoPreviewRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoPreviewRef.current, 0, 0)
    canvas.toBlob(async (blob) => {
      if (!blob) return
      stopCamera()
      const file = new File([blob], `witness-${Date.now()}.jpg`, { type: 'image/jpeg' })
      await processFile(file)
    }, 'image/jpeg', 0.92)
  }

  const startVideoRecording = () => {
    if (!cameraStream) return
    const mr = new MediaRecorder(cameraStream, { mimeType: 'video/webm;codecs=vp8' })
    chunksRef.current = []
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      stopCamera()
      const file = new File([blob], `witness-${Date.now()}.webm`, { type: 'video/webm' })
      await processFile(file)
    }
    mr.start(); setMediaRecorder(mr); setRecording(true)
    addLog('Recording...')
  }

  const stopVideoRecording = () => {
    mediaRecorder?.stop(); setRecording(false)
  }

  const processFile = async (f: File) => {
    if (!identity) return
    setStatus('encrypting')
    addLog(`Securing ${f.name} (${(f.size/1024).toFixed(1)} KB)...`)
    try {
      const buf = await f.arrayBuffer()
      const bytes = new Uint8Array(buf)
      const hash = await sha256Hex(buf)
      addLog(`SHA-256: ${hash.slice(0,16)}... encrypting...`)
      const { encryptedData, encryptedKey } = await encryptFile(bytes, identity.publicKey)
      const type: WitnessRecord['type'] = f.type.startsWith('video') ? 'video' : f.type.startsWith('audio') ? 'audio' : 'photo'
      setStatus('publishing')
      addLog('Publishing hash to Nostr...')
      const eventId = await publishHashToNostr(hash, type, identity.privateKeyRaw, identity.publicKey)
      if (eventId) addLog(`Hash anchored. Event: ${eventId.slice(0,16)}...`)
      else addLog('Relay offline — hash stored locally only.')
      const record: WitnessRecord = {
        id: crypto.randomUUID(), type, fileName: f.name, sha256: hash,
        nostrEventId: eventId, timestamp: Date.now(), isoCtime: new Date().toISOString(),
        encryptedKey, encryptedData
      }
      saveRecord(record)
      setRecords(loadRecords())
      setStatus('done')
      addLog('Evidence secured.')
      setTimeout(() => setStatus('idle'), 2000)
    } catch (err) {
      addLog(`ERROR: ${err instanceof Error ? err.message : 'Failed'}`)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2000)
    }
  }

  const typeIcon = (t: WitnessRecord['type']) => t === 'video' ? '▶' : t === 'audio' ? '♪' : '◉'

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ borderBottom: '1px solid var(--border)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr / silent witness</span>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href="/app" style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest hover:opacity-80">← back</Link>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 py-10 max-w-2xl mx-auto w-full gap-6">
        <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed w-full">
          Capture evidence. The file is encrypted instantly on your device and its hash is anchored to Nostr. Even if your device is seized and wiped, the hash proves the file existed at this exact moment.
        </p>

        {/* Camera overlay */}
        {cameraActive && (
          <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
            <video ref={videoPreviewRef} autoPlay playsInline muted style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
            <div style={{ background: '#000', padding: '16px 24px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
              {!recording ? (
                <>
                  <button onClick={capturePhoto}
                    style={{ background: '#fff', color: '#000', border: 'none', cursor: 'pointer', borderRadius: '50%', width: 64, height: 64, fontSize: '24px' }}>
                    ◉
                  </button>
                  <button onClick={startVideoRecording}
                    style={{ background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '50%', width: 64, height: 64, fontSize: '14px' }}>
                    ▶ REC
                  </button>
                  <button onClick={stopCamera}
                    style={{ background: 'none', color: '#fff', border: '1px solid #555', cursor: 'pointer', borderRadius: '50%', width: 64, height: 64, fontSize: '20px' }}>
                    ✕
                  </button>
                </>
              ) : (
                <button onClick={stopVideoRecording}
                  style={{ background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '50%', width: 64, height: 64, fontSize: '14px', animation: 'pulse 1s infinite' }}>
                  ■ STOP
                </button>
              )}
            </div>
          </div>
        )}
        {/* Capture buttons */}
        <div className="grid w-full gap-2" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }}>
          <button onClick={() => startCamera('photo')}
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
            className="py-5 text-xs uppercase tracking-widest hover:opacity-80">
            ◉ Camera
          </button>
          <button onClick={() => startCamera('video')}
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
            className="py-5 text-xs uppercase tracking-widest hover:opacity-80">
            ▶ Record
          </button>
          <button onClick={() => photoInputRef.current?.click()}
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
            className="py-5 text-xs uppercase tracking-widest hover:opacity-80">
            ↑ Photo / File
          </button>
          <button onClick={() => audioInputRef.current?.click()}
            style={{ border: '1px solid var(--border)', color: 'var(--text-2)', background: 'none', cursor: 'pointer' }}
            className="py-5 text-xs uppercase tracking-widest hover:opacity-80">
            ♪ Audio
          </button>
        </div>
        <input ref={photoInputRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx" className="hidden" onChange={handleCapture} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={handleCapture} />
        <input ref={audioInputRef} type="file" accept="audio/*" capture="microphone" className="hidden" onChange={handleCapture} />
        <input ref={fileRef} type="file" className="hidden" onChange={handleCapture} />

        {/* Status */}
        {status !== 'idle' && (
          <div style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="w-full p-3">
            <p style={{ color: status === 'error' ? '#ef4444' : status === 'done' ? '#22c55e' : 'var(--text-3)' }} className="text-xs">
              {status === 'encrypting' ? '⟳ Encrypting...' : status === 'publishing' ? '⟳ Anchoring to Nostr...' : status === 'done' ? '✓ Secured' : '✗ Error'}
            </p>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)' }} className="w-full pt-3 flex flex-col gap-1">
            {log.map((l,i) => <p key={i} style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">{l}</p>)}
          </div>
        )}

        {/* Records */}
        {records.length > 0 && (
          <div className="w-full flex flex-col gap-2">
            <p style={{ color: 'var(--text-5)' }} className="text-xs uppercase tracking-widest mb-2">Secured evidence ({records.length})</p>
            {records.map(r => (
              <div key={r.id} style={{ border: '1px solid var(--border)', background: 'var(--bg-2)' }} className="p-3 flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--text-3)' }} className="text-xs">{typeIcon(r.type)}</span>
                    <span style={{ color: 'var(--text-2)' }} className="text-xs truncate">{r.fileName}</span>
                  </div>
                  <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">{r.isoCtime}</p>
                  <p style={{ color: 'var(--text-5)', fontSize: '10px' }} className="font-mono">
                    {r.nostrEventId ? `⚓ ${r.nostrEventId.slice(0,20)}...` : '⚠ local only'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleDecrypt(r)}
                    disabled={decrypting === r.id}
                    style={{ border: '1px solid var(--border-2)', color: 'var(--text-3)', background: 'none', cursor: 'pointer', opacity: decrypting === r.id ? 0.4 : 1 }}
                    className="px-3 py-1 text-xs hover:opacity-80">
                    {decrypting === r.id ? '...' : '↓'}
                  </button>
                  <button onClick={() => { deleteRecord(r.id); setRecords(loadRecords()) }}
                    style={{ border: '1px solid var(--border)', color: 'var(--text-5)', background: 'none', cursor: 'pointer' }}
                    className="px-3 py-1 text-xs hover:opacity-80">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {records.length === 0 && status === 'idle' && (
          <p style={{ color: 'var(--text-5)' }} className="text-xs text-center mt-8">No evidence captured yet.</p>
        )}
      </div>
    </main>
  )
}
