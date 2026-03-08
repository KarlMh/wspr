import SimplePeer from 'simple-peer'
import { generateSecretKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'

const CALL_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://offchain.pub',
  'wss://relay.primal.net',
  'wss://nostr.wine',
]

const CALL_KIND = 20002

export type CallState = 'idle' | 'calling' | 'receiving' | 'connected' | 'ended'

export type CallSignal = {
  type: 'offer' | 'answer' | 'ice' | 'hangup' | 'ring'
  data?: string
  callId: string
  from: string
}

function getRingTag(a: string, b: string): string {
  const sorted = [a, b].sort()
  let h = 0
  const s = 'ring' + sorted[0] + sorted[1]
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) >>> 0
  return `wc_${h.toString(16)}`
}

function getSignalTag(callId: string): string {
  let h = 0
  for (let i = 0; i < callId.length; i++) h = ((h << 5) - h + callId.charCodeAt(i)) >>> 0
  return `ws_${h.toString(16)}`
}

async function encryptSignal(data: string, secret: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', secret.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(data))
  const out = new Uint8Array(12 + ct.byteLength)
  out.set(iv); out.set(new Uint8Array(ct), 12)
  return btoa(String.fromCharCode(...out))
}

async function decryptSignal(b64: string, secret: Uint8Array): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', secret.slice(0, 32), { name: 'AES-GCM' }, false, ['decrypt'])
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
    return new TextDecoder().decode(pt)
  } catch { return null }
}

export class CallManager {
  private listenPool: SimplePool | null = null
  private listenSub: { close: () => void } | null = null
  private listenMyPubKey = ''
  private listenTheirPubKey = ''
  private listenSharedSecret: Uint8Array | null = null
  private listenStartedAt = 0

  private callPool: SimplePool | null = null
  private callSub: { close: () => void } | null = null
  private publishPool: SimplePool | null = null
  private ephemeralKey: Uint8Array | null = null

  private peer: SimplePeer.Instance | null = null
  private localStream: MediaStream | null = null
  private signalBuffer: string[] = []

  private state: CallState = 'idle'
  private callId = ''
  private seenEvents = new Set<string>()
  private declinedCallIds = new Set<string>()
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private isRestarting = false

  private audioCtx: AudioContext | null = null
  private localAnalyser: AnalyserNode | null = null
  private remoteAnalyser: AnalyserNode | null = null
  private voiceTimer: ReturnType<typeof setInterval> | null = null

  onStateChange: ((s: CallState) => void) | null = null
  onRemoteStream: ((s: MediaStream) => void) | null = null
  onIncomingCall: ((callId: string, from: string) => void) | null = null
  onError: ((e: string) => void) | null = null
  onLocalVolume: ((v: number) => void) | null = null
  onRemoteVolume: ((v: number) => void) | null = null

  async listenForCalls(myPubKey: string, sharedSecret: Uint8Array, theirPubKey: string): Promise<void> {
    if (this.isRestarting) return
    this.isRestarting = true
    try {
      if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
      if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }

      const isNewContact = this.listenTheirPubKey !== theirPubKey || this.listenMyPubKey !== myPubKey
      this.listenMyPubKey = myPubKey
      this.listenTheirPubKey = theirPubKey
      this.listenSharedSecret = sharedSecret
      this.listenStartedAt = Math.floor(Date.now() / 1000)

      if (isNewContact) {
        this.declinedCallIds.clear()
        this.seenEvents.clear()
      }

      this.listenPool = new SimplePool()
      const ringTag = getRingTag(myPubKey, theirPubKey)
      console.log('[CALL] listening on tag:', ringTag)

      const filter = { kinds: [CALL_KIND], since: this.listenStartedAt }
      ;(filter as Record<string, unknown>)['#t'] = [ringTag]

      this.listenSub = this.listenPool.subscribeMany(
        CALL_RELAYS,
        filter as unknown as Filter,
        {
          onevent: async (event) => {
            if (this.seenEvents.has(event.id)) return
            this.seenEvents.add(event.id)
            if (event.created_at < this.listenStartedAt) return

            const decrypted = await decryptSignal(event.content, sharedSecret)
            if (!decrypted) return
            let signal: CallSignal
            try { signal = JSON.parse(decrypted) } catch { return }
            if (signal.from === myPubKey) return

            console.log('[CALL] ring event:', signal.type, 'state:', this.state)

            if (signal.type === 'hangup') {
              if (this.state === 'calling' || this.state === 'receiving' || this.state === 'connected') {
                this._cleanup(false)
              }
              return
            }

            if (signal.type === 'ring') {
              if (this.state === 'calling') {
                if (myPubKey < theirPubKey) {
                  console.log('[CALL] mutual call — becoming answerer')
                  if (this.peer) { this.peer.destroy(); this.peer = null }
                  this.callId = signal.callId
                  await this._subscribeSignals(myPubKey, sharedSecret)
                  this._createPeer(false, myPubKey, sharedSecret)
                }
                return
              }
              if (this.state === 'idle' || this.state === 'ended') {
                if (this.declinedCallIds.has(signal.callId)) return
                console.log('[CALL] incoming call')
                this.callId = signal.callId
                this.signalBuffer = []
                this._setState('receiving')
                this.onIncomingCall?.(signal.callId, signal.from)
              }
            }
          }
        }
      )
    } finally {
      this.isRestarting = false
    }
  }

  async startCall(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array, video = false): Promise<void> {
    this.callId = crypto.randomUUID()
    this.ephemeralKey = generateSecretKey()
    this.publishPool = new SimplePool()
    this._setState('calling')

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._cleanup(true)
      return
    }

    this._startVoiceActivity()
    await this._subscribeSignals(myPubKey, sharedSecret)
    await new Promise(r => setTimeout(r, 1200))
    this._createPeer(true, myPubKey, sharedSecret)

    const ringTag = getRingTag(myPubKey, theirPubKey)
    for (let i = 0; i < 3; i++) {
      await this._publish(ringTag, sharedSecret, { type: 'ring', callId: this.callId, from: myPubKey })
      await new Promise(r => setTimeout(r, 800))
    }
  }

  async answerCall(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array, callId: string, video = false): Promise<void> {
    this.callId = callId
    this.ephemeralKey = generateSecretKey()
    this.publishPool = new SimplePool()

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._cleanup(true)
      return
    }

    this._startVoiceActivity()
    await this._subscribeSignals(myPubKey, sharedSecret)
    await new Promise(r => setTimeout(r, 400))
    this._createPeer(false, myPubKey, sharedSecret)
  }

  async declineCall(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array, callId: string): Promise<void> {
    this.declinedCallIds.add(callId)
    this.ephemeralKey = generateSecretKey()
    this.publishPool = new SimplePool()
    const hangup: CallSignal = { type: 'hangup', callId, from: myPubKey }
    await this._publish(getRingTag(myPubKey, theirPubKey), sharedSecret, hangup)
    await this._publish(getSignalTag(callId), sharedSecret, hangup)
    if (this.publishPool) { this.publishPool.close(CALL_RELAYS); this.publishPool = null }
    this.ephemeralKey = null
    this._setState('idle')
    this.callId = ''
    this.signalBuffer = []
  }

  async hangup(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    if (this.callId && sharedSecret.length > 0) {
      await this._publish(getSignalTag(this.callId), sharedSecret, { type: 'hangup', callId: this.callId, from: myPubKey })
      await this._publish(getRingTag(myPubKey, theirPubKey), sharedSecret, { type: 'hangup', callId: this.callId, from: myPubKey })
    }
    this._cleanup(true)
  }

  stopListening(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
    if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }
    this.listenMyPubKey = ''
    this.listenTheirPubKey = ''
    this.listenSharedSecret = null
  }

  getLocalStream(): MediaStream | null { return this.localStream }
  getState(): CallState { return this.state }

  private _setState(s: CallState): void {
    this.state = s
    this.onStateChange?.(s)
  }

  private async _subscribeSignals(myPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    if (this.callSub) { this.callSub.close(); this.callSub = null }
    if (this.callPool) { this.callPool.close(CALL_RELAYS); this.callPool = null }

    this.callPool = new SimplePool()
    const signalTag = getSignalTag(this.callId)
    const filter = { kinds: [CALL_KIND], since: Math.floor(Date.now() / 1000) - 5 }
    ;(filter as Record<string, unknown>)['#t'] = [signalTag]

    this.callSub = this.callPool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          if (this.seenEvents.has(event.id)) return
          this.seenEvents.add(event.id)
          const decrypted = await decryptSignal(event.content, sharedSecret)
          if (!decrypted) return
          let signal: CallSignal
          try { signal = JSON.parse(decrypted) } catch { return }
          if (signal.from === myPubKey) return
          if (signal.callId !== this.callId) return

          console.log('[CALL] signal:', signal.type, 'peer:', !!this.peer)

          if (signal.type === 'hangup') { this._cleanup(true); return }

          if (signal.data) {
            if (this.peer) {
              try { this.peer.signal(JSON.parse(signal.data)) } catch { /* ignore stale */ }
            } else {
              this.signalBuffer.push(signal.data)
            }
          }
        }
      }
    )
  }

  private _createPeer(initiator: boolean, myPubKey: string, sharedSecret: Uint8Array): void {
    this.peer = new SimplePeer({
      initiator,
      stream: this.localStream!,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
        ]
      }
    })

    if (this.signalBuffer.length > 0) {
      const buffered = [...this.signalBuffer]
      this.signalBuffer = []
      setTimeout(() => { buffered.forEach(d => { try { this.peer?.signal(JSON.parse(d)) } catch { /* ignore */ } }) }, 100)
    }

    this.peer.on('signal', async (data) => {
      const sig: CallSignal = {
        type: data.type === 'offer' ? 'offer' : data.type === 'answer' ? 'answer' : 'ice',
        data: JSON.stringify(data), callId: this.callId, from: myPubKey
      }
      await this._publish(getSignalTag(this.callId), sharedSecret, sig)
    })

    this.peer.on('stream', (stream: MediaStream) => {
      this._attachRemoteVolume(stream)
      this.onRemoteStream?.(stream)
      this._setState('connected')
    })

    this.peer.on('connect', () => { if (this.state !== 'connected') this._setState('connected') })
    this.peer.on('error', (err: Error) => { console.log('[CALL] peer error:', err.message); this.onError?.(err.message); this._cleanup(true) })
    this.peer.on('close', () => { if (this.state !== 'ended') this._cleanup(true) })
  }

  private async _publish(tag: string, secret: Uint8Array, signal: CallSignal): Promise<void> {
    if (!this.ephemeralKey || !this.publishPool) return
    try {
      const encrypted = await encryptSignal(JSON.stringify(signal), secret)
      const event = finalizeEvent({ kind: CALL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tag]], content: encrypted }, this.ephemeralKey)
      await Promise.any(this.publishPool.publish(CALL_RELAYS, event))
      console.log('[CALL] published', signal.type)
    } catch (e) { console.log('[CALL] publish failed', e) }
  }

  private _cleanup(restartListener: boolean): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null }
    if (this.voiceTimer) { clearInterval(this.voiceTimer); this.voiceTimer = null }
    if (this.audioCtx) { this.audioCtx.close(); this.audioCtx = null }
    if (this.peer) { this.peer.destroy(); this.peer = null }
    if (this.callSub) { this.callSub.close(); this.callSub = null }
    if (this.callPool) { this.callPool.close(CALL_RELAYS); this.callPool = null }
    if (this.publishPool) { this.publishPool.close(CALL_RELAYS); this.publishPool = null }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null }
    this.ephemeralKey = null
    this.localAnalyser = null
    this.remoteAnalyser = null
    this.signalBuffer = []
    this.callId = ''
    this._setState('ended')

    if (restartListener) {
      const myKey = this.listenMyPubKey
      const secret = this.listenSharedSecret
      const theirKey = this.listenTheirPubKey
      if (myKey && secret && theirKey) {
        console.log('[CALL] scheduling listener restart')
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          this.listenForCalls(myKey, secret, theirKey)
        }, 1500)
      }
    }
  }

  private _startVoiceActivity(): void {
    if (!this.localStream) return
    try {
      this.audioCtx = new AudioContext()
      const src = this.audioCtx.createMediaStreamSource(this.localStream)
      this.localAnalyser = this.audioCtx.createAnalyser()
      this.localAnalyser.fftSize = 256
      src.connect(this.localAnalyser)
      const data = new Uint8Array(this.localAnalyser.frequencyBinCount)
      this.voiceTimer = setInterval(() => {
        if (!this.localAnalyser) return
        this.localAnalyser.getByteFrequencyData(data)
        this.onLocalVolume?.(Math.min(100, data.reduce((a, b) => a + b, 0) / data.length * 3))
      }, 50)
    } catch { /* unavailable */ }
  }

  private _attachRemoteVolume(stream: MediaStream): void {
    if (!this.audioCtx) return
    try {
      const src = this.audioCtx.createMediaStreamSource(stream)
      this.remoteAnalyser = this.audioCtx.createAnalyser()
      this.remoteAnalyser.fftSize = 256
      src.connect(this.remoteAnalyser)
      const data = new Uint8Array(this.remoteAnalyser.frequencyBinCount)
      setInterval(() => {
        if (!this.remoteAnalyser) return
        this.remoteAnalyser.getByteFrequencyData(data)
        this.onRemoteVolume?.(Math.min(100, data.reduce((a, b) => a + b, 0) / data.length * 3))
      }, 50)
    } catch { /* unavailable */ }
  }
}
