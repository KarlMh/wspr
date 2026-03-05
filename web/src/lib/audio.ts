const DELIMITER = '<<<END>>>'
const SAMPLE_RATE = 44100
const DURATION_SECONDS = 10

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

function generateWAV(samples: Int16Array): ArrayBuffer {
  const numSamples = samples.length
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = numChannels * bitsPerSample / 8
  const byteRate = SAMPLE_RATE * blockAlign
  const dataSize = numSamples * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, samples[i], true)
  }

  return buffer
}

function parseWAV(buffer: ArrayBuffer): Int16Array {
  const view = new DataView(buffer)
  const dataOffset = 44
  const numSamples = (buffer.byteLength - dataOffset) / 2
  const samples = new Int16Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    samples[i] = view.getInt16(dataOffset + i * 2, true)
  }
  return samples
}

function generateNoise(): Int16Array {
  const numSamples = SAMPLE_RATE * DURATION_SECONDS
  const samples = new Int16Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.floor((Math.random() - 0.5) * 1000)
  }
  return samples
}

export function encodeAudio(message: string): Blob {
  const bits = textToBits(message)
  const samples = generateNoise()

  if (bits.length > samples.length) {
    throw new Error('Message too long for audio carrier.')
  }

  for (let i = 0; i < bits.length; i++) {
    samples[i] = (samples[i] & ~1) | bits[i]
  }

  const wav = generateWAV(samples)
  return new Blob([wav], { type: 'audio/wav' })
}

export function decodeAudio(buffer: ArrayBuffer): string {
  const samples = parseWAV(buffer)
  const bits: number[] = []

  for (let i = 0; i < samples.length; i++) {
    bits.push(samples[i] & 1)
  }

  return bitsToText(bits)
}

export function getAudioCapacity(): number {
  return Math.floor((SAMPLE_RATE * DURATION_SECONDS) / 8)
}
