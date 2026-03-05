import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Whisper',
  description: 'Free online image utility. No uploads required.',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
