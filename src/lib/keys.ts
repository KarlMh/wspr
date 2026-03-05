// ECDH key exchange using Web Crypto API
// P-256 curve — widely supported, strong enough for this use case

export type KeyPair = {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyRaw: string // base64 encoded for sharing
}

export async function generateKeyPair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )

  const publicKeyBuffer = await crypto.subtle.exportKey('raw', pair.publicKey)
  const publicKeyRaw = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))

  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyRaw
  }
}

export async function deriveSharedSecret(
  privateKey: CryptoKey,
  theirPublicKeyRaw: string
): Promise<Uint8Array> {
  // Import their public key
  const theirPublicKeyBytes = Uint8Array.from(
    atob(theirPublicKeyRaw),
    c => c.charCodeAt(0)
  )

  const theirPublicKey = await crypto.subtle.importKey(
    'raw',
    theirPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )

  // Derive shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirPublicKey },
    privateKey,
    256
  )

  return new Uint8Array(sharedBits)
}

export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey)
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
}

export async function importPrivateKey(raw: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
}
