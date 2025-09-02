import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Puppeteer Scraper',
  description: 'Scrape data from any URL using CSS selectors (single or list)',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-6xl p-6">
          {children}
        </div>
      </body>
    </html>
  )
}
