import { createLightNode, waitForRemotePeer, createEncoder, createDecoder } from '@waku/sdk'

function getContentTopic(myPubKey: string, theirPubKey: string): string {
  const sorted = [myPubKey, theirPubKey].sort()
  let hash = 0
  const str = sorted[0] + sorted[1]
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) >>> 0
  }
  return `/wspr/1/${hash.toString(16)}/proto`
}

export type WakuMessage = {
  id: string
  from: string
  ciphertext: string
  timestamp: number
  type: 'text' | 'image' | 'file'
  fileName?: string
}

function encodeMessage(msg: WakuMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg))
}

function decodeMessage(bytes: Uint8Array): WakuMessage | null {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

export class WakuChat {
  private node: Awaited<ReturnType<typeof createLightNode>> | null = null
  private contentTopic: string = ''
  private onMessage: ((msg: WakuMessage) => void) | null = null
  private unsubscribe: (() => void) | null = null

  async connect(
    myPubKey: string,
    theirPubKey: string,
    onMessage: (msg: WakuMessage) => void
  ): Promise<void> {
    this.contentTopic = getContentTopic(myPubKey, theirPubKey)
    this.onMessage = onMessage

    this.node = await createLightNode({ defaultBootstrap: true })
    await this.node.start()
    await waitForRemotePeer(this.node)

    const decoder = createDecoder(this.contentTopic)
    const { unsubscribe } = await this.node.filter.subscribe(
      [decoder],
      (wakuMsg) => {
        if (!wakuMsg.payload) return
        const msg = decodeMessage(wakuMsg.payload)
        if (msg && this.onMessage) this.onMessage(msg)
      }
    )
    this.unsubscribe = unsubscribe
  }

  async send(msg: WakuMessage): Promise<void> {
    if (!this.node) throw new Error('Not connected')
    const encoder = createEncoder({ contentTopic: this.contentTopic })
    await this.node.lightPush.send(encoder, { payload: encodeMessage(msg) })
  }

  async disconnect(): Promise<void> {
    if (this.unsubscribe) this.unsubscribe()
    if (this.node) await this.node.stop()
    this.node = null
  }

  isConnected(): boolean {
    return this.node !== null
  }

  getContentTopic(): string {
    return this.contentTopic
  }
}
