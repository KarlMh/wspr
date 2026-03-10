'use client'
import { useTheme } from '@/lib/theme'
import Link from 'next/link'

export default function AppHub() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-3)' }} className="text-xs tracking-widest uppercase">wspr</span>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px' }}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <Link href="/" style={{ color: 'var(--text-4)' }} className="text-xs transition-all uppercase tracking-widest hover:opacity-80">
            ← back
          </Link>
        </div>
      </div>

      {/* Hub */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <p style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest mb-12">Select mode</p>

        <div className="w-full max-w-lg flex flex-col gap-3">

          <Link href="/app/tool"
            style={{ border: '1px solid var(--border)' }}
            className="group p-6 transition-all hover:opacity-90 block"
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div className="flex items-start justify-between mb-4">
              <p style={{ color: 'var(--text-2)' }} className="text-sm uppercase tracking-widest">Steganography</p>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">→</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed mb-4">
              Hide encrypted messages inside images or audio files. AES-256-GCM encryption, hardened LSB embedding, generative Perlin noise carrier.
            </p>
            <div className="flex flex-wrap gap-2">
              {['AES-256-GCM', 'LSB hardened', 'Perlin carrier', 'ECDH', 'EXIF strip'].map(tag => (
                <span key={tag} style={{ color: 'var(--text-5)', border: '1px solid var(--border)' }} className="text-xs px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>

          <Link href="/chat"
            style={{ border: '1px solid var(--border)' }}
            className="group p-6 transition-all hover:opacity-90 block"
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div className="flex items-start justify-between mb-4">
              <p style={{ color: 'var(--text-2)' }} className="text-sm uppercase tracking-widest">Encrypted Chat</p>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">→</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed mb-4">
              P2P encrypted messaging over Nostr. No server, no account, no phone number. Identity is a keypair stored in an encrypted file you control.
            </p>
            <div className="flex flex-wrap gap-2">
              {['Nostr P2P', 'AES-256-GCM', 'No IP leak', 'Contact book', 'File sharing'].map(tag => (
                <span key={tag} style={{ color: 'var(--text-5)', border: '1px solid var(--border)' }} className="text-xs px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>
          <Link href="/app/proof"
            style={{ border: '1px solid var(--border)' }}
            className="group p-6 transition-all hover:opacity-90 block"
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div className="flex items-start justify-between mb-4">
              <p style={{ color: 'var(--text-2)' }} className="text-sm uppercase tracking-widest">Proof Bundle</p>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">→</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed mb-4">
              Cryptographically notarize any document. Hash, sign with your identity, anchor to Nostr. Generates a self-contained .proof file anyone can verify offline — no server, no account.
            </p>
            <div className="flex flex-wrap gap-2">
              {['SHA-256', 'ECDSA signed', 'Nostr timestamp', 'Offline verify', 'No server'].map(tag => (
                <span key={tag} style={{ color: 'var(--text-5)', border: '1px solid var(--border)' }} className="text-xs px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>
          <Link href="/app/chess"
            style={{ border: '1px solid var(--border)' }}
            className="group p-6 transition-all hover:opacity-90 block"
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div className="flex items-start justify-between mb-4">
              <p style={{ color: 'var(--text-2)' }} className="text-sm uppercase tracking-widest">Chess</p>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">→</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed mb-4">
              Challenge contacts to encrypted chess over Nostr. Moves are encrypted with your shared secret. No server, no account, no spectators.
            </p>
            <div className="flex flex-wrap gap-2">
              {['E2E encrypted', 'Nostr P2P', 'Full rules', 'No server'].map(tag => (
                <span key={tag} style={{ color: 'var(--text-5)', border: '1px solid var(--border)' }} className="text-xs px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>
          <Link href="/app/witness"
            style={{ border: '1px solid var(--border)' }}
            className="group p-6 transition-all hover:opacity-90 block"
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-3)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}>
            <div className="flex items-start justify-between mb-4">
              <p style={{ color: 'var(--text-2)' }} className="text-sm uppercase tracking-widest">Silent Witness</p>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">→</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed mb-4">
              Capture photo, video, or audio evidence. Encrypted instantly on your device, hash anchored to Nostr permanently. Even if your device is wiped, the proof survives.
            </p>
            <div className="flex flex-wrap gap-2">
              {['AES-256-GCM', 'Nostr anchor', 'Device-only', 'Tamper proof', 'Offline'].map(tag => (
                <span key={tag} style={{ color: 'var(--text-5)', border: '1px solid var(--border)' }} className="text-xs px-2 py-0.5">{tag}</span>
              ))}
            </div>
          </Link>
        </div>

        <p style={{ color: 'var(--text-5)' }} className="text-xs mt-12">Everything runs in your browser. Nothing is transmitted unencrypted.</p>
      </div>

    </main>
  )
}
