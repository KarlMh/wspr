import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'wspr — steganography utility',
  description: 'Hide encrypted messages inside images. AES-256-GCM encryption, hardened LSB steganography, ECDH key exchange. Zero server. Client-side only.',
  keywords: ['steganography', 'encryption', 'privacy', 'security', 'AES-256', 'open source'],
  authors: [{ name: 'wspr' }],
  openGraph: {
    title: 'wspr — steganography utility',
    description: 'Hide encrypted messages inside images. Zero server. Client-side only.',
    type: 'website',
    url: 'https://wsprnet.vercel.app',
  },
  twitter: {
    card: 'summary',
    title: 'wspr — steganography utility',
    description: 'Hide encrypted messages inside images. Zero server. Client-side only.',
  },
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  robots: {
    index: true,
    follow: false,
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
