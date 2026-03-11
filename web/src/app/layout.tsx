import type { Metadata, Viewport } from 'next'
import LockBar from '@/components/LockBar'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

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
    <html lang="en" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          try {
            var t = localStorage.getItem('wspr_theme');
            if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
          } catch(e) {}
        })();
      `}} />
      <body>
        <div style={{ paddingBottom: '48px' }}>{children}</div>
        <LockBar />
      </body>
    </html>
  )
}
