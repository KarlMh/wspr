// Double Ratchet implementation for wspr
// Provides forward secrecy: each message uses a unique derived key
// Ratchet state is memory-only — lost on refresh triggers fresh handshake

export type RatchetState = {
  // DH ratchet
  dhSendKey: CryptoKeyPair        // our current ephemeral keypair
  dhRecvKey: CryptoKey | null     // their latest ephemeral pubkey
  // Chain keys (raw bytes, advanced per message)
  rootKey: Uint8Array
  sendChainKey: Uint8Array | null
  recvChainKey: Uint8Array | null
  // Message counters
  sendCount: number
  recvCount: number
}

// In-memory store: channelId -> RatchetState
const ratchets = new Map<string, RatchetState>()

export function channelId(myPubKey: string, theirPubKey: string): string {
  return [myPubKey, theirPubKey].sort().join(':')
}

export function getRatchet(myPubKey: string, theirPubKey: string): RatchetState | null {
  return ratchets.get(channelId(myPubKey, theirPubKey)) ?? null
}

export function setRatchet(myPubKey: string, theirPubKey: string, state: RatchetState): void {
  ratchets.set(channelId(myPubKey, theirPubKey), state)
}

export function clearRatchet(myPubKey: string, theirPubKey: string): void {
  ratchets.delete(channelId(myPubKey, theirPubKey))
}

// HKDF extract+expand
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer
}
async function hkdf(
  inputKey: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', toArrayBuffer(inputKey), 'HKDF', false, ['deriveKey', 'deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: enc.encode(info) },
    keyMaterial,
    length * 8
  )
  return new Uint8Array(bits)
}

// KDF chain step: chainKey -> (newChainKey, messageKey)
async function kdfChain(chainKey: Uint8Array): Promise<{ newChainKey: Uint8Array; messageKey: Uint8Array }> {
  const newChainKey = await hkdf(chainKey, new Uint8Array([1]), 'wspr-chain-key')
  const messageKey = await hkdf(chainKey, new Uint8Array([2]), 'wspr-message-key')
  return { newChainKey, messageKey }
}

// DH ratchet step: derive new root key and chain key from DH output
async function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): Promise<{ newRootKey: Uint8Array; chainKey: Uint8Array }> {
  const newRootKey = await hkdf(dhOutput, rootKey, 'wspr-root-key')
  const chainKey = await hkdf(dhOutput, rootKey, 'wspr-chain-init')
  return { newRootKey, chainKey }
}

// ECDH between our private key and their public key
async function dh(privateKey: CryptoKey, publicKeyRaw: Uint8Array): Promise<Uint8Array> {
  const pubKey = await crypto.subtle.importKey(
    'raw', publicKeyRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: pubKey },
    privateKey,
    256
  )
  return new Uint8Array(bits)
}

// Export public key as base64
async function exportPub(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(raw)))
}

// Import public key from base64
async function importPub(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'raw', raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true, []
  )
}

// Initialize ratchet from shared secret (first message)
export async function initRatchet(
  sharedSecret: Uint8Array,
  myPubKey: string,
  theirPubKey: string
): Promise<RatchetState> {
  const dhKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const rootKey = await hkdf(sharedSecret, new Uint8Array(32), 'wspr-root-init')
  const state: RatchetState = {
    dhSendKey: dhKeyPair,
    dhRecvKey: null,
    rootKey,
    sendChainKey: null,
    recvChainKey: null,
    sendCount: 0,
    recvCount: 0,
  }
  setRatchet(myPubKey, theirPubKey, state)
  return state
}

// Encrypt with ratchet — returns { ciphertext, ratchetPub }
export async function ratchetEncrypt(
  plaintext: string,
  myPubKey: string,
  theirPubKey: string,
  sharedSecret: Uint8Array,
  messageId: string
): Promise<{ ciphertext: string; ratchetPub: string }> {
  let state = getRatchet(myPubKey, theirPubKey)
  if (!state) state = await initRatchet(sharedSecret, myPubKey, theirPubKey)

  // Init send chain if needed
  if (!state.sendChainKey) {
    const dhOut = state.dhRecvKey
      ? await dh(state.dhSendKey.privateKey, await exportPubRaw(state.dhRecvKey))
      : new Uint8Array(32) // no recv key yet — use zeros for first send
    const { newRootKey, chainKey } = await kdfRootKey(state.rootKey, dhOut)
    state.rootKey = newRootKey
    state.sendChainKey = chainKey
  }

  // Advance send chain
  const { newChainKey, messageKey } = await kdfChain(state.sendChainKey)
  state.sendChainKey = newChainKey
  state.sendCount++

  // Encrypt with message key
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey('raw', messageKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const enc = new TextEncoder()
  const ciphertextBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, enc.encode(plaintext))
  const combined = new Uint8Array(iv.length + ciphertextBuf.byteLength)
  combined.set(iv); combined.set(new Uint8Array(ciphertextBuf), iv.length)

  const ratchetPub = await exportPub(state.dhSendKey.publicKey)
  setRatchet(myPubKey, theirPubKey, state)
  return { ciphertext: btoa(String.fromCharCode(...combined)), ratchetPub }
}

// Helper to export CryptoKey as raw bytes
async function exportPubRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return new Uint8Array(raw)
}

// Decrypt with ratchet
export async function ratchetDecrypt(
  ciphertext: string,
  ratchetPub: string,
  myPubKey: string,
  theirPubKey: string,
  sharedSecret: Uint8Array,
): Promise<string | null> {
  try {
    let state = getRatchet(myPubKey, theirPubKey)
    if (!state) state = await initRatchet(sharedSecret, myPubKey, theirPubKey)

    // DH ratchet step if new key from sender
    const newDhKey = await importPub(ratchetPub)
    const newDhKeyRaw = await exportPubRaw(newDhKey)
    const currentRecvRaw = state.dhRecvKey ? await exportPubRaw(state.dhRecvKey) : null
    const isNewDhKey = !currentRecvRaw || !currentRecvRaw.every((b, i) => b === newDhKeyRaw[i])

    if (isNewDhKey) {
      // Perform DH ratchet step
      const dhOut = await dh(state.dhSendKey.privateKey, newDhKeyRaw)
      const { newRootKey, chainKey } = await kdfRootKey(state.rootKey, dhOut)
      state.rootKey = newRootKey
      state.recvChainKey = chainKey
      state.dhRecvKey = newDhKey
      state.recvCount = 0
      // Generate new send keypair for next send
      state.dhSendKey = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
      )
      state.sendChainKey = null // reset send chain
    }

    if (!state.recvChainKey) return null

    // Advance recv chain
    const { newChainKey, messageKey } = await kdfChain(state.recvChainKey)
    state.recvChainKey = newChainKey
    state.recvCount++

    // Decrypt
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
    const iv = combined.slice(0, 12)
    const ct = combined.slice(12)
    const cryptoKey = await crypto.subtle.importKey('raw', messageKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct)

    setRatchet(myPubKey, theirPubKey, state)
    return new TextDecoder().decode(plainBuf)
  } catch {
    return null
  }
}
