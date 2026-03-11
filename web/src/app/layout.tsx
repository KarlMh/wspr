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
      <head>
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="wspr" />
        <meta name="theme-color" content="#0a0a0a" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          try {
            var t = localStorage.getItem('wspr_theme');
            if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
          } catch(e) {}
        })();
      `}} />
      <body>
        <div style={{ paddingBottom: '38px' }}>{children}</div>
        <LockBar />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
          }
        `}} />
      </body>
    </html>
  )
}
