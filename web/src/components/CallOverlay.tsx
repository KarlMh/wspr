'use client'
import { useEffect, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { CallState } from '@/lib/call'

type Props = {
  state: CallState
  contactName: string
  duration: number
  localVolume: number
  remoteVolume: number
  muted: boolean
  remoteStream: MediaStream | null
  onAnswer: () => void
  onDecline: () => void
  onHangup: () => void
  onMute: () => void
  onClose: () => void
}

function VoiceRings({ volume, label }: { volume: number; label: string }) {
  const active = volume > 8
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex items-center justify-center w-20 h-20">
        {[1, 2, 3].map((r) => (
          <div key={r} className="absolute rounded-full border transition-all duration-100"
            style={{
              width: `${20 + r * 16 + (active ? volume * 0.3 * r : 0)}px`,
              height: `${20 + r * 16 + (active ? volume * 0.3 * r : 0)}px`,
              borderColor: active ? `rgba(161,161,170,${0.4 - r * 0.1})` : `rgba(100,100,110,${0.4 - r * 0.1})`,
              opacity: active ? 1 : 0.3,
            }} />
        ))}
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: `2px solid ${active ? 'var(--border-3)' : 'var(--border)'}`,
          background: active ? 'var(--bg-3)' : 'var(--bg-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s'
        }}>
          <span className="text-lg">{label === 'You' ? '🎙' : '🔊'}</span>
        </div>
      </div>
      <p style={{ color: active ? 'var(--text-2)' : 'var(--text-5)' }} className="text-xs tracking-widest uppercase transition-all">{label}</p>
    </div>
  )
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}

export default function CallOverlay({ state, contactName, duration, localVolume, remoteVolume, muted, remoteStream, onAnswer, onDecline, onHangup, onMute, onClose }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const { theme } = useTheme()

  useEffect(() => {
    if (audioRef.current && remoteStream) audioRef.current.srcObject = remoteStream
  }, [remoteStream])

  const overlayBg = theme === 'light' ? 'rgba(250,250,250,0.97)' : 'rgba(9,9,11,0.97)'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ fontFamily: 'monospace', backgroundColor: overlayBg, height: '100dvh' }}>
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <div className="w-full max-w-sm flex flex-col items-center gap-6 px-6 py-8"
        style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))', paddingTop: 'max(2rem, env(safe-area-inset-top))' }}>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 mb-1">
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: state === 'connected' ? 'var(--text-3)' : state === 'calling' || state === 'receiving' ? '#eab308' : 'var(--text-5)',
              animation: (state === 'calling' || state === 'receiving') ? 'pulse 1.5s infinite' : 'none'
            }} />
            <span style={{ color: 'var(--text-4)' }} className="text-xs uppercase tracking-widest">
              {state === 'calling' ? 'calling' : state === 'receiving' ? 'incoming call' : state === 'connected' ? 'connected' : state === 'ended' ? 'call ended' : ''}
            </span>
          </div>
          <p style={{ color: 'var(--text-1)' }} className="text-sm uppercase tracking-widest">{contactName}</p>
          {state === 'connected' && <p style={{ color: 'var(--text-4)' }} className="text-xs font-mono">{formatDuration(duration)}</p>}
        </div>

        {state === 'connected' && (
          <div className="flex items-end justify-center gap-16">
            <VoiceRings volume={muted ? 0 : localVolume} label="You" />
            <VoiceRings volume={remoteVolume} label={contactName} />
          </div>
        )}

        {state === 'calling' && (
          <div className="flex flex-col items-center gap-3">
            <div style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--border)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="absolute inset-0 rounded-full animate-ping opacity-30" style={{ border: '1px solid var(--border-3)' }} />
              <span className="text-2xl">☎</span>
            </div>
            <p style={{ color: 'var(--text-4)' }} className="text-xs">Waiting for {contactName}...</p>
          </div>
        )}

        {state === 'receiving' && (
          <div className="flex flex-col items-center gap-3">
            <div style={{ width: 64, height: 64, borderRadius: '50%', border: '1px solid var(--border-2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ border: '1px solid var(--border-3)' }} />
              <div className="absolute rounded-full animate-ping opacity-20" style={{ inset: 8, border: '1px solid var(--border-2)', animationDelay: '0.3s' }} />
              <span className="text-2xl">☎</span>
            </div>
          </div>
        )}

        {state === 'connected' && (
          <div style={{ border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-4)' }} />
            <span style={{ color: 'var(--text-4)' }} className="text-xs">DTLS-SRTP · P2P · Nostr signaling</span>
          </div>
        )}

        <div className="flex gap-3 w-full">
          {state === 'receiving' && (<>
            <button onClick={onAnswer} style={{ border: '1px solid var(--border-3)', color: 'var(--text-1)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:opacity-80">Answer</button>
            <button onClick={onDecline} style={{ border: '1px solid var(--border)', color: 'var(--text-4)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:border-red-800 hover:text-red-700">Decline</button>
          </>)}
          {state === 'calling' && (
            <button onClick={onDecline} style={{ border: '1px solid var(--border)', color: 'var(--text-4)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:border-red-800 hover:text-red-700">Cancel</button>
          )}
          {state === 'connected' && (<>
            <button onClick={onMute}
              style={muted ? { border: '1px solid var(--border-3)', color: 'var(--text-1)', background: 'var(--bg-3)' } : { border: '1px solid var(--border)', color: 'var(--text-4)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:opacity-80">
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button onClick={onHangup} style={{ border: '1px solid var(--border)', color: 'var(--text-4)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:border-red-800 hover:text-red-700">End</button>
          </>)}
          {state === 'ended' && (
            <button onClick={onClose} style={{ border: '1px solid var(--border)', color: 'var(--text-4)' }}
              className="flex-1 text-xs py-4 uppercase tracking-widest transition-all hover:opacity-80">Close</button>
          )}
        </div>

        {state === 'connected' && (
          <p style={{ color: 'var(--text-5)' }} className="text-xs text-center">Your IP may be visible to your peer. Use a VPN for full anonymity.</p>
        )}
      </div>
    </div>
  )
}
