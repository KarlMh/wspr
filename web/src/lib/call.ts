import SimplePeer from 'simple-peer'
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import { encryptMessage, decryptMessage } from './chat-crypto'

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

function getRingTag(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = 'ring' + sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `wc_${hash.toString(16)}`
}

function getSignalTag(callId: string): string {
  let hash = 0
  for (let i = 0; i < callId.length; i++) {
    hash = ((hash << 5) - hash + callId.charCodeAt(i)) >>> 0
  }
  return `ws_${hash.toString(16)}`
}

function randomDelay(): Promise<void> {
  return new Promise(r => setTimeout(r, Math.random() * 1000))
}

export class CallManager {
  // Two separate pools — listener never gets closed during calls
  private listenPool: SimplePool | null = null
  private callPool: SimplePool | null = null
  private listenSub: { close: () => void } | null = null
  private callSub: { close: () => void } | null = null
  private ephemeralPrivKey: Uint8Array | null = null
  private peer: SimplePeer.Instance | null = null
  private callId: string = ''
  private localStream: MediaStream | null = null
  private state: CallState = 'idle'

  onStateChange: ((state: CallState) => void) | null = null
  onRemoteStream: ((stream: MediaStream) => void) | null = null
  onIncomingCall: ((callId: string, from: string) => void) | null = null
  onError: ((err: string) => void) | null = null

  // Called once when chat connects — stays open permanently
  async listenForCalls(
    myPubKey: string,
    sharedSecret: Uint8Array,
    theirPubKey: string
  ): Promise<void> {
    // Close previous listener if any
    if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
    if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }

    this.listenPool = new SimplePool()
    const ringTag = getRingTag(myPubKey, theirPubKey)

    const filter = { kinds: [CALL_KIND], since: Math.floor(Date.now() / 1000) - 5 }
    ;(filter as Record<string, unknown>)['#t'] = [ringTag]

    this.listenSub = this.listenPool.subscribeMany(
      CALL_RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          try {
            const decrypted = await decryptMessage(event.content, sharedSecret, event.id)
            if (!decrypted) return
            const signal: CallSignal = JSON.parse(decrypted)
            if (signal.type !== 'ring') return
            if (signal.from === myPubKey) return // ignore own ring
            this.callId = signal.callId
            this.onIncomingCall?.(signal.callId, signal.from)
          } catch { /* not for us */ }
        }
      }
    )
  }

  async startCall(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    video = false
  ): Promise<void> {
    this.callId = crypto.randomUUID()
    this.ephemeralPrivKey = generateSecretKey()
    this._setState('calling')

    // Get media first
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    // Subscribe to answer/ice signals
    await this._subscribeToCallSignals(myPubKey, sharedSecret)

    // Create initiator peer
    this._createPeer(true, myPubKey, theirPubKey, sharedSecret)

    // Send ring — use random delay for metadata protection
    await randomDelay()
    const ringTag = getRingTag(myPubKey, theirPubKey)
    await this._publish(ringTag, sharedSecret, {
      type: 'ring',
      callId: this.callId,
      from: myPubKey
    })
  }

  async answerCall(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    callId: string,
    video = false
  ): Promise<void> {
    this.callId = callId
    this.ephemeralPrivKey = generateSecretKey()
    this._setState('receiving')

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video })
    } catch {
      this.onError?.('Microphone access denied.')
      this._setState('ended')
      return
    }

    await this._subscribeToCallSignals(myPubKey, sharedSecret)
    this._createPeer(false, myPubKey, theirPubKey, sharedSecret)
  }

  private _createPeer(
    initiator: boolean,
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array
  ): void {
    this.peer = new SimplePeer({
      initiator,
      stream: this.localStream!,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ]
      }
    })

    this.peer.on('signal', async (data) => {
      const signalTag = getSignalTag(this.callId)
      await this._publish(signalTag, sharedSecret, {
        type: data.type === 'offer' ? 'offer' : data.type === 'answer' ? 'answer' : 'ice',
        data: JSON.stringify(data),
        callId: this.callId,
        from: myPubKey
      })
    })

    this.peer.on('stream', (stream: MediaStream) => {
      this.onRemoteStream?.(stream)
      this._setState('connected')
    })

    this.peer.on('connect', () => this._setState('connected'))
    this.peer.on('error', (err: Error) => { this.onError?.(err.message); this._cleanup() })
    this.peer.on('close', () => this._cleanup())
  }

  private async _subscribeToCallSignals(
    myPubKey: string,
    sharedSecret: Uint8Array
  ): Promise<void> {
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
          try {
            const decrypted = await decryptMessage(event.content, sharedSecret, event.id)
            if (!decrypted) return
            const signal: CallSignal = JSON.parse(decrypted)
            if (signal.from === myPubKey) return
            if (signal.callId !== this.callId) return

            if (signal.type === 'hangup') { this._cleanup(); return }
            if (signal.data && this.peer) {
              this.peer.signal(JSON.parse(signal.data))
            }
          } catch { /* not for us */ }
        }
      }
    )
  }

  private async _publish(
    tag: string,
    sharedSecret: Uint8Array,
    signal: CallSignal
  ): Promise<void> {
    const privKey = this.ephemeralPrivKey
    if (!privKey) return
    const pool = this.listenPool || new SimplePool()
    const encrypted = await encryptMessage(JSON.stringify(signal), sharedSecret, crypto.randomUUID())
    const event = finalizeEvent({
      kind: CALL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', tag]],
      content: encrypted,
    }, privKey)
    try { await Promise.any(pool.publish(CALL_RELAYS, event)) } catch { /* relay unavailable */ }
  }

  async hangup(myPubKey: string, theirPubKey: string, sharedSecret: Uint8Array): Promise<void> {
    if (this.callId && sharedSecret.length > 0) {
      const signalTag = getSignalTag(this.callId)
      await this._publish(signalTag, sharedSecret, { type: 'hangup', callId: this.callId, from: myPubKey })
    }
    this._cleanup()
  }

  stopListening(): void {
    if (this.listenSub) { this.listenSub.close(); this.listenSub = null }
    if (this.listenPool) { this.listenPool.close(CALL_RELAYS); this.listenPool = null }
  }

  private _setState(state: CallState): void {
    this.state = state
    this.onStateChange?.(state)
  }

  private _cleanup(): void {
    if (this.peer) { this.peer.destroy(); this.peer = null }
    if (this.callSub) { this.callSub.close(); this.callSub = null }
    if (this.callPool) { this.callPool.close(CALL_RELAYS); this.callPool = null }
    if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null }
    this.ephemeralPrivKey = null
    this._setState('ended')
  }

  getLocalStream(): MediaStream | null { return this.localStream }
  getState(): CallState { return this.state }
}
