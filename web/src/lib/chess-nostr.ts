import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import { encryptMessage, decryptMessage } from './chat-crypto'
import type { ChessMessage } from './chess'

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://offchain.pub',
]

// Use kind 1 (regular note) so relays don't filter it out
const CHESS_KIND = 1

function getChessTag(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = 'chess_' + sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  return `wspr_chess_${hash.toString(16)}`
}

export class ChessNostr {
  private pool: SimplePool | null = null
  private privKey: Uint8Array | null = null
  private pubKey: string = ''
  private channelTag = ''
  private seen = new Set<string>()
  private sub: { close: () => void } | null = null
  private onMsgCb: ((msg: ChessMessage) => void) | null = null

  async connect(
    myPubKey: string,
    theirPubKey: string,
    sharedSecret: Uint8Array,
    onMessage: (msg: ChessMessage) => void
  ) {
    this.channelTag = getChessTag(myPubKey, theirPubKey)
    this.onMsgCb = onMessage
    this.privKey = generateSecretKey()
    this.pubKey = getPublicKey(this.privKey)
    this.pool = new SimplePool()

    console.log('[chess-nostr] connecting, tag:', this.channelTag)

    const since = Math.floor(Date.now() / 1000) - 600
    const filter: Record<string, unknown> = {
      kinds: [CHESS_KIND],
      since,
      '#t': [this.channelTag]
    }

    this.sub = this.pool.subscribeMany(
      RELAYS,
      filter as unknown as Filter,
      {
        onevent: async (event) => {
          console.log('[chess-nostr] raw event received, id:', event.id.slice(0,8), 'pubkey:', event.pubkey.slice(0,8))
          if (this.seen.has(event.id)) return
          this.seen.add(event.id)
          if (event.pubkey === this.pubKey) return
          try {
            const plain = await decryptMessage(event.content, sharedSecret, event.id)
            console.log('[chess-nostr] decrypted:', plain?.slice(0, 80))
            if (!plain) return
            const msg: ChessMessage = JSON.parse(plain)
            console.log('[chess-nostr] parsed msg type:', msg.type)
            if (this.onMsgCb) this.onMsgCb(msg)
          } catch (e) {
            console.error('[chess-nostr] decrypt/parse error:', e)
          }
        }
      }
    )
    console.log('[chess-nostr] subscribed to tag:', this.channelTag)
  }

  async send(msg: ChessMessage, sharedSecret: Uint8Array) {
    if (!this.pool || !this.privKey) throw new Error('Not connected')
    const id = crypto.randomUUID()
    const ciphertext = await encryptMessage(JSON.stringify(msg), sharedSecret, id)
    this.seen.add(id)
    const event = finalizeEvent({
      kind: CHESS_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', this.channelTag]],
      content: ciphertext,
    }, this.privKey)
    console.log('[chess-nostr] sending msg type:', msg.type, 'tag:', this.channelTag, 'event id:', event.id.slice(0,8))
    let published = false
    for (const relay of RELAYS) {
      try {
        await Promise.race([
          this.pool.publish([relay], event).then(() => { published = true; console.log('[chess-nostr] published to', relay) }),
          new Promise((_, r) => setTimeout(r, 5000))
        ])
        if (published) break
      } catch {}
    }
    if (!published) console.error('[chess-nostr] failed to publish to any relay')
  }

  disconnect() {
    this.sub?.close()
    this.pool?.close(RELAYS)
    this.pool = null
    this.sub = null
    this.seen.clear()
  }
}
