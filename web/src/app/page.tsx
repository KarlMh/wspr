'use client'
import { useTheme } from '@/lib/theme'
import Link from 'next/link'

export default function Landing() {
  const { theme, toggle: toggleTheme } = useTheme()

  return (
    <main style={{ fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-1)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }} className="px-6 py-4 flex items-center justify-between">
        <span style={{ color: 'var(--text-2)' }} className="text-sm tracking-widest uppercase">wspr</span>
        <div className="flex items-center gap-4">
          <button
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{ color: 'var(--text-4)', background: 'none', border: '1px solid var(--border-2)', padding: '2px 8px', cursor: 'pointer', fontSize: '12px', transition: 'all 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-1)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-4)')}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <a href="https://github.com/KarlMh/wspr"
            target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--text-3)' }}
            className="text-xs transition-all tracking-widest uppercase hover:opacity-80">
            GitHub
          </a>
          <Link href="/app"
            style={{ border: '1px solid var(--border-3)', color: 'var(--text-1)' }}
            className="text-xs uppercase tracking-widest px-4 py-1.5 transition-all hover:opacity-80">
            Launch
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
          {['Open Source', 'Zero Server', 'Client-Side Only', 'P2P Chat'].map(tag => (
            <span key={tag} style={{ color: 'var(--text-4)', border: '1px solid var(--border)' }} className="text-xs uppercase tracking-widest px-3 py-1">
              {tag}
            </span>
          ))}
        </div>

        <h1 style={{ color: 'var(--text-1)' }} className="text-4xl md:text-6xl tracking-tight mb-6 max-w-3xl">
          Hide messages. Communicate securely.
        </h1>

        <p style={{ color: 'var(--text-3)' }} className="text-sm md:text-base max-w-xl mb-10 leading-relaxed">
          wspr is a privacy toolkit for people who need more than encryption.
          Hide messages inside images. Chat over a decentralized P2P network.
          Not just unreadable — invisible.
        </p>
        <Link href="/app"
          style={{ border: '1px solid var(--border-3)', color: 'var(--text-1)' }}
          className="text-sm uppercase tracking-widest px-8 py-3 transition-all hover:opacity-80">
          Open wspr →
        </Link>
      </section>

      {/* Threat model */}
      <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-16 max-w-4xl mx-auto w-full">
        <p style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest mb-8">Who it&apos;s for</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { title: 'Journalists', body: 'Communicate with sources across monitored channels. Hide messages in images or use the P2P encrypted chat — no phone number, no account, no server.' },
            { title: 'Activists', body: 'Operate in environments where encrypted messages invite scrutiny. wspr produces carrier images indistinguishable from ordinary photos, and a chat that leaves no server trace.' },
            { title: 'Security researchers', body: 'Evaluate steganographic techniques. Mode A uses hardened LSB with chi-square normalization. Mode B uses generative Perlin noise carriers.' }
          ].map(({ title, body }) => (
            <div key={title} style={{ border: '1px solid var(--border)' }} className="p-5">
              <p style={{ color: 'var(--text-2)' }} className="text-xs uppercase tracking-widest mb-3">{title}</p>
              <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-16 max-w-4xl mx-auto w-full">
        <p style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest mb-8">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { step: '01', title: 'Encrypt', body: 'Your message is encrypted with AES-256-GCM using your password, keyfile, or an ECDH-derived shared secret. A SHA-256 integrity hash is embedded.' },
            { step: '02', title: 'Hide', body: 'The ciphertext is scattered across pixel LSBs using a key-seeded pseudo-random permutation. Every unused pixel is filled with key-derived noise to defeat statistical analysis.' },
            { step: '03', title: 'Send', body: 'The output is a standard PNG with EXIF metadata stripped. It passes visual inspection, chi-square tests, and sequential pattern detectors.' }
          ].map(({ step, title, body }) => (
            <div key={step} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span style={{ color: 'var(--text-5)' }} className="text-xs">{step}</span>
                <div style={{ background: 'var(--border)' }} className="flex-1 h-px" />
              </div>
              <p style={{ color: 'var(--text-2)' }} className="text-xs uppercase tracking-widest">{title}</p>
              <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature list */}
      <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-16 max-w-4xl mx-auto w-full">
        <p style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest mb-8">Technical features</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            ['AES-256-GCM encryption', 'Industry-standard authenticated encryption'],
            ['PBKDF2 key derivation', '100,000 iterations, SHA-256'],
            ['Temporal keys', '2-hour expiry window — old messages auto-expire'],
            ['ECDH key exchange', 'Establish shared secrets without transmitting them'],
            ['Safety numbers', 'Verify key exchange integrity out-of-band'],
            ['LSB scatter pattern', 'Key-seeded pixel permutation — defeats sequential detectors'],
            ['Chi-square normalization', 'LSB distribution matches natural image statistics'],
            ['Whole-image noise fill', 'All unused pixels randomized — no statistical signature'],
            ['Generative carrier', 'Perlin noise images — nothing was modified, nothing to detect'],
            ['Audio steganography', 'Hide messages in WAV files'],
            ['Deniability layer', 'Dual-channel encoding — alternate key reveals alternate message'],
            ['EXIF stripping', 'All metadata removed from output files'],
            ['SHA-256 integrity', 'Detect tampering in transit'],
            ['Panic wipe', 'ESC × 2 clears all state instantly'],
            ['Auto-clear', '5-minute inactivity wipe'],
            ['Zero server', 'Everything runs in the browser — nothing is transmitted'],
            ['P2P encrypted chat', 'Nostr protocol — decentralized, no IP leak, no account'],
            ['Keypair identity', 'Your .wspr file is your identity — portable, password-encrypted'],
            ['Contact book', 'Save contacts by public key, scoped to your identity'],
            ['Chat file sharing', 'Send encrypted images and files over Nostr'],
          ].map(([feature, description]) => (
            <div key={feature} style={{ borderBottom: '1px solid var(--border)' }} className="flex gap-3 py-2">
              <span style={{ color: 'var(--text-3)' }} className="text-xs w-48 flex-shrink-0">{feature}</span>
              <span style={{ color: 'var(--text-4)' }} className="text-xs">{description}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Open source */}
      <section style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-16 max-w-4xl mx-auto w-full">
        <p style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest mb-8">Open source</p>
        <div style={{ border: '1px solid var(--border)' }} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p style={{ color: 'var(--text-2)' }} className="text-xs mb-2">MIT License — audit it, fork it, self-host it.</p>
            <p style={{ color: 'var(--text-4)' }} className="text-xs leading-relaxed max-w-lg">
              wspr is fully open source. The cryptographic implementation is auditable.
              No obfuscation, no telemetry, no server. If you don&apos;t trust the hosted version, run it locally in under a minute.
            </p>
          </div>
          <a href="https://github.com/KarlMh/wspr"
            target="_blank" rel="noopener noreferrer"
            style={{ border: '1px solid var(--border-2)', color: 'var(--text-3)' }}
            className="text-xs uppercase tracking-widest px-6 py-3 transition-all hover:opacity-80 whitespace-nowrap">
            View on GitHub →
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)' }} className="px-6 py-6 flex items-center justify-between">
        <span style={{ color: 'var(--text-5)' }} className="text-xs">wspr — steganography utility</span>
        <Link href="/app"
          style={{ color: 'var(--text-4)' }}
          className="text-xs transition-all uppercase tracking-widest hover:opacity-80">
          Launch tool →
        </Link>
      </footer>

    </main>
  )
}
