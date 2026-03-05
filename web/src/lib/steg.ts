const DELIMITER = '<<<END>>>'

function textToBits(text: string): number[] {
  return (text + DELIMITER).split('').flatMap(char => {
    const byte = char.charCodeAt(0)
    return Array.from({length: 8}, (_, i) => (byte >> (7 - i)) & 1)
  })
}

function bitsToText(bits: number[]): string {
  let text = ''
  for (let i = 0; i + 7 < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0)
    text += String.fromCharCode(byte)
    if (text.endsWith(DELIMITER)) {
      return text.slice(0, -DELIMITER.length)
    }
  }
  return text
}

function seededShuffle(indices: number[], seed: Uint8Array): number[] {
  let s = (seed[0] << 24 | seed[1] << 16 | seed[2] << 8 | seed[3]) >>> 0
  if (s === 0) s = 1

  const arr = [...indices]
  for (let i = arr.length - 1; i > 0; i--) {
    s ^= s << 13
    s ^= s >> 17
    s ^= s << 5
    s = s >>> 0
    const j = s % (i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function getScatterIndices(pixelCount: number, key: Uint8Array): number[] {
  const indices = Array.from({ length: pixelCount }, (_, i) => i)
  return seededShuffle(indices, key)
}

export function encode(
  imageData: ImageData,
  realPayload: string,
  decoyPayload: string,
  key?: Uint8Array
): ImageData {
  const realBits = textToBits(realPayload)
  const decoyBits = textToBits(decoyPayload)
  const pixelCount = imageData.data.length / 4

  if (realBits.length > pixelCount) throw new Error('Real message too long. Use a larger image.')
  if (decoyBits.length > pixelCount) throw new Error('Decoy message too long. Use a larger image.')

  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height
  )

  const realIndices = key
    ? getScatterIndices(pixelCount, key)
    : Array.from({ length: pixelCount }, (_, i) => i)
  const decoyIndices = key
    ? getScatterIndices(pixelCount, key.map(b => b ^ 0xFF))
    : Array.from({ length: pixelCount }, (_, i) => i)

  for (let i = 0; i < realBits.length; i++) {
    const pixelIndex = realIndices[i]
    result.data[pixelIndex * 4] = (result.data[pixelIndex * 4] & 0xFE) | realBits[i]
  }

  for (let i = 0; i < decoyBits.length; i++) {
    const pixelIndex = decoyIndices[i]
    result.data[pixelIndex * 4 + 1] = (result.data[pixelIndex * 4 + 1] & 0xFE) | decoyBits[i]
  }

  return result
}

export function decodeChannel(
  imageData: ImageData,
  channel: 0 | 1,
  key?: Uint8Array
): string {
  const pixelCount = imageData.data.length / 4
  const pixels = imageData.data

  let indices: number[]
  if (key) {
    const seedKey = channel === 0 ? key : key.map(b => b ^ 0xFF)
    indices = getScatterIndices(pixelCount, seedKey)
  } else {
    indices = Array.from({ length: pixelCount }, (_, i) => i)
  }

  const bits: number[] = []
  for (let i = 0; i < pixelCount; i++) {
    const pixelIndex = indices[i]
    bits.push(pixels[pixelIndex * 4 + channel] & 1)
  }

  return bitsToText(bits)
}
