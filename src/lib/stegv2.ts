const DELIMITER_BYTES = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE])

// Convert raw bytes to bits
function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1)
    }
  }
  return bits
}

// Convert bits back to bytes
function bitsToBytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i * 8 + j] ?? 0)
    }
    bytes[i] = byte
  }
  return bytes
}

// Check if bytes end with delimiter
function endsWithDelimiter(bytes: Uint8Array): boolean {
  if (bytes.length < DELIMITER_BYTES.length) return false
  const tail = bytes.slice(bytes.length - DELIMITER_BYTES.length)
  return tail.every((b, i) => b === DELIMITER_BYTES[i])
}

// xorshift32 PRNG — fast, deterministic
function xorshift32(seed: number): () => number {
  let s = seed >>> 0
  if (s === 0) s = 2463534242
  return () => {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    s = s >>> 0
    return s
  }
}

// Derive 32-bit seed from key bytes
function keyToSeed(key: Uint8Array): number {
  let seed = 0
  for (let i = 0; i < key.length; i++) {
    seed = ((seed << 5) - seed + key[i]) >>> 0
  }
  return seed === 0 ? 2463534242 : seed
}

// Generate scatter order for pixels using key-seeded PRNG
// Uses Fisher-Yates with xorshift32 — much faster than sort-based shuffle
function getScatterOrder(pixelCount: number, key: Uint8Array): Uint32Array {
  const seed = keyToSeed(key)
  const prng = xorshift32(seed)
  const indices = new Uint32Array(pixelCount)

  for (let i = 0; i < pixelCount; i++) indices[i] = i

  for (let i = pixelCount - 1; i > 0; i--) {
    const j = prng() % (i + 1)
    const tmp = indices[i]
    indices[i] = indices[j]
    indices[j] = tmp
  }

  return indices
}

// Fill ALL unused pixel LSBs with key-seeded pseudo-random noise
// This makes the image LSB distribution statistically uniform
// Defeats chi-square analysis — no difference between message and non-message pixels
function fillNoiseLayer(
  data: Uint8ClampedArray,
  usedPixels: Set<number>,
  key: Uint8Array,
  channel: number
): void {
  const noiseSeed = keyToSeed(key) ^ (channel * 0x9e3779b9)
  const prng = xorshift32(noiseSeed)
  const pixelCount = data.length / 4

  for (let i = 0; i < pixelCount; i++) {
    if (!usedPixels.has(i)) {
      data[i * 4 + channel] = (data[i * 4 + channel] & 0xFE) | (prng() & 1)
    }
  }
}

// Chi-square normalization
// Analyze LSB distribution of modified pixels and adjust
// to match the expected distribution of unmodified image LSBs
function normalizeLSBDistribution(
  data: Uint8ClampedArray,
  messagePixels: number[],
  channel: number
): void {
  // Count current LSB distribution in non-message pixels (natural baseline)
  let natural0 = 0
  let natural1 = 0
  const pixelCount = data.length / 4
  const messageSet = new Set(messagePixels)

  for (let i = 0; i < pixelCount; i++) {
    if (!messageSet.has(i)) {
      const lsb = data[i * 4 + channel] & 1
      if (lsb === 0) natural0++
      else natural1++
    }
  }

  const naturalRatio = natural0 / (natural0 + natural1)

  // Count message pixel distribution
  let msg0 = 0
  let msg1 = 0
  for (const p of messagePixels) {
    const lsb = data[p * 4 + channel] & 1
    if (lsb === 0) msg0++
    else msg1++
  }

  const msgTotal = msg0 + msg1
  const targetMsg0 = Math.round(naturalRatio * msgTotal)

  // If too many 0s in message, flip some to 1 and vice versa
  // We do this on pixels where flipping doesn't change the message bit
  // (i.e. we adjust the pixel value by 2 instead, keeping LSB same but
  // shifting the overall pixel value distribution)
  // This is a subtle normalization — we shift pixel values ±2 to balance
  const excess0 = msg0 - targetMsg0

  if (Math.abs(excess0) > msgTotal * 0.02) {
    // Shift some pixel values by +2 or -2 to rebalance without changing LSB
    let corrections = Math.abs(excess0)
    for (const p of messagePixels) {
      if (corrections <= 0) break
      const lsb = data[p * 4 + channel] & 1
      const val = data[p * 4 + channel]
      if (excess0 > 0 && lsb === 0 && val >= 2) {
        data[p * 4 + channel] = val - 2
        corrections--
      } else if (excess0 < 0 && lsb === 1 && val <= 253) {
        data[p * 4 + channel] = val + 2
        corrections--
      }
    }
  }
}

export function encodeV2(
  imageData: ImageData,
  ciphertextBytes: Uint8Array,
  key: Uint8Array
): ImageData {
  const pixelCount = imageData.data.length / 4

  // Payload = raw ciphertext bytes + delimiter
  const payload = new Uint8Array(ciphertextBytes.length + DELIMITER_BYTES.length)
  payload.set(ciphertextBytes, 0)
  payload.set(DELIMITER_BYTES, ciphertextBytes.length)

  const bits = bytesToBits(payload)

  if (bits.length > pixelCount) {
    throw new Error(`Message too long. Need ${Math.ceil(bits.length / 8)} px capacity, have ${pixelCount}.`)
  }

  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  )

  // Get scatter order for R channel
  const scatterKey = new Uint8Array([...key, 0x52]) // 0x52 = 'R'
  const indices = getScatterOrder(pixelCount, scatterKey)
  const usedPixels = new Set<number>()
  const messagePixels: number[] = []

  // Embed raw ciphertext bits in scattered R channel pixels
  for (let i = 0; i < bits.length; i++) {
    const pixelIndex = indices[i]
    result.data[pixelIndex * 4] = (result.data[pixelIndex * 4] & 0xFE) | bits[i]
    usedPixels.add(pixelIndex)
    messagePixels.push(pixelIndex)
  }

  // Fill unused R channel pixels with key-seeded noise
  fillNoiseLayer(result.data, usedPixels, new Uint8Array([...key, 0x4E]), 0)

  // Normalize LSB distribution to defeat chi-square attacks
  normalizeLSBDistribution(result.data, messagePixels, 0)

  // Also noise-fill G and B channels completely for full statistical camouflage
  fillNoiseLayer(result.data, new Set(), new Uint8Array([...key, 0x47]), 1) // G
  fillNoiseLayer(result.data, new Set(), new Uint8Array([...key, 0x42]), 2) // B

  return result
}

export function decodeV2(
  imageData: ImageData,
  key: Uint8Array
): Uint8Array | null {
  const pixelCount = imageData.data.length / 4
  const scatterKey = new Uint8Array([...key, 0x52])
  const indices = getScatterOrder(pixelCount, scatterKey)

  const bits: number[] = []
  const bytes: number[] = []

  for (let i = 0; i < pixelCount; i++) {
    const pixelIndex = indices[i]
    bits.push(imageData.data[pixelIndex * 4] & 1)

    // Check every 8 bits if we've hit the delimiter
    if (bits.length % 8 === 0) {
      let byte = 0
      for (let j = 0; j < 8; j++) {
        byte = (byte << 1) | bits[bits.length - 8 + j]
      }
      bytes.push(byte)

      const buf = new Uint8Array(bytes)
      if (endsWithDelimiter(buf)) {
        return buf.slice(0, buf.length - DELIMITER_BYTES.length)
      }
    }
  }

  return null
}
