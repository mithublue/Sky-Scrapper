import ScrapeForm from '@/components/ScrapeForm'

export default function Page() {
  return (
    <main>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Puppeteer Scraper</h1>
        <p className="text-gray-600">Enter a URL and selectors to extract data. Supports single item or lists.</p>
      </header>
      <ScrapeForm />
    </main>
  )
}
