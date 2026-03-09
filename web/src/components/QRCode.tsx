'use client'
import { useEffect, useRef } from 'react'
import QRCodeLib from 'qrcode'

export default function QRCode({ value, size = 160 }: { value: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!canvasRef.current || !value) return
    QRCodeLib.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: {
        dark: getComputedStyle(document.documentElement).getPropertyValue('--text-1').trim() || '#000',
        light: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fff',
      }
    })
  }, [value, size])

  return <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} />
}
