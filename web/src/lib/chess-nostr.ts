// Simple chess transport — posts JSON events tagged with a private channel hash
// Channel tag is a hash of both pubkeys so only they can find it
import { generateSecretKey, getPublicKey, finalizeEvent, SimplePool } from 'nostr-tools'
import type { Filter } from 'nostr-tools'
import type { ChessMessage } from './chess'

const RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
  'wss://relay.primal.net',
]

function getChessTag(a: string, b: string): string {
  const sorted = [a, b].sort()
  let hash = 0
  const str = 'wspr_chess_' + sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  return `wc_${hash.toString(16)}`
}

export class ChessTransport {
  private pool: SimplePool | null = null
  private privKey: Uint8Array | null = null
  private pubKey = ''
  private tag = ''
  private seen = new Set<string>()
  private sub: { close: () => void } | null = null

  async connect(myPub: string, theirPub: string, onMsg: (msg: ChessMessage) => void) {
    this.tag = getChessTag(myPub, theirPub)
    this.privKey = generateSecretKey()
    this.pubKey = getPublicKey(this.privKey)
    this.pool = new SimplePool()

    console.log('[chess-transport] tag:', this.tag)

    const filter: Record<string, unknown> = {
      kinds: [30078],
      since: Math.floor(Date.now() / 1000) - 300,
      '#d': [this.tag],
    }

    this.sub = this.pool.subscribeMany(RELAYS, filter as unknown as Filter, {
      onevent: (event) => {
        if (this.seen.has(event.id)) return
        this.seen.add(event.id)
        if (event.pubkey === this.pubKey) return
        try {
          const msg: ChessMessage = JSON.parse(event.content)
          console.log('[chess-transport] received:', msg.type)
          onMsg(msg)
        } catch (e) {
          console.error('[chess-transport] parse error:', e)
        }
      }
    })
  }

  async send(msg: ChessMessage) {
    if (!this.pool || !this.privKey) return
    const event = finalizeEvent({
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', this.tag]],
      content: JSON.stringify(msg),
    }, this.privKey)
    this.seen.add(event.id)
    console.log('[chess-transport] sending:', msg.type, 'to tag:', this.tag)
    try {
      await Promise.any(this.pool.publish(RELAYS, event))
      console.log('[chess-transport] published OK')
    } catch {
      console.error('[chess-transport] publish failed')
    }
  }

  disconnect() {
    this.sub?.close()
    this.pool?.close(RELAYS)
    this.pool = null
    this.sub = null
    this.seen.clear()
  }
}
