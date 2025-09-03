import { NextResponse } from 'next/server'
import * as puppeteer from 'puppeteer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Suggestion = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
  confidence: number
  source: string
}

type DiscoverResult = {
  ok: true
  mode: 'single' | 'list' | 'unknown'
  listItemSelector?: string
  suggestions: Suggestion[]
  nextButtonSelector?: string
  prevButtonSelector?: string
} | { ok: false; error: string }

type Body = {
  url: string
  timeoutMs?: number
}

export async function POST(req: Request) {
  let browser: puppeteer.Browser | null = null
  try {
    const body = (await req.json()) as Body
    const { url, timeoutMs } = body

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'Valid url is required' }, { status: 400 })
    }

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
    const page = await browser.newPage()
    const navTimeout = Math.min(Math.max(timeoutMs ?? 60000, 10000), 120000)
    page.setDefaultNavigationTimeout(navTimeout)
    page.setDefaultTimeout(navTimeout)
    await page.setViewport({ width: 1366, height: 1000 })
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    } catch (e) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    }

    // Attempt cookie consent accept (OneTrust)
    try {
      const consentBtn = await page.$('#onetrust-accept-btn-handler')
      if (consentBtn) {
        await consentBtn.click()
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    } catch {}

    const res = await page.evaluate(() => {
      const suggestions: Suggestion[] = [] as any

      const pushUnique = (s: Suggestion) => {
        if (!s.selector) return
        const key = `${s.name}|${s.selector}|${s.type}|${s.attr ?? ''}`
        // @ts-ignore
        if ((pushUnique as any)._set?.has(key)) return
        // @ts-ignore
        if (!(pushUnique as any)._set) (pushUnique as any)._set = new Set<string>()
        // @ts-ignore
        ;(pushUnique as any)._set.add(key)
        suggestions.push(s)
      }

      // Heuristics for "single" page content
      const h1 = document.querySelector('h1')
      if (h1?.textContent?.trim()) {
        pushUnique({ name: 'title', selector: 'h1', type: 'text', confidence: 0.6, source: 'h1' })
      }
      const h2 = document.querySelector('h2')
      if (h2?.textContent?.trim()) {
        pushUnique({ name: 'subtitle', selector: 'h2', type: 'text', confidence: 0.4, source: 'h2' })
      }
      const metaOgTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement | null
      if (metaOgTitle?.content) {
        pushUnique({ name: 'og_title', selector: 'meta[property="og:title"]', type: 'attr', attr: 'content', confidence: 0.7, source: 'meta' })
      }
      const metaDescription = document.querySelector('meta[name="description"]') as HTMLMetaElement | null
      if (metaDescription?.content) {
        pushUnique({ name: 'description', selector: 'meta[name="description"]', type: 'attr', attr: 'content', confidence: 0.6, source: 'meta' })
      }
      const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null
      if (canonical?.href) {
        pushUnique({ name: 'canonical', selector: 'link[rel="canonical"]', type: 'attr', attr: 'href', confidence: 0.8, source: 'link' })
      }
      const firstImg = document.querySelector('img') as HTMLImageElement | null
      if (firstImg?.src) {
        pushUnique({ name: 'image', selector: 'img', type: 'attr', attr: 'src', confidence: 0.3, source: 'img' })
      }

      // Data-testid driven hints (common on Booking.com)
      const testidEls = Array.from(document.querySelectorAll('[data-testid]')) as HTMLElement[]
      const testidCounts: Record<string, number> = {}
      for (const el of testidEls) {
        const val = el.getAttribute('data-testid') || ''
        if (!val) continue
        testidCounts[val] = (testidCounts[val] || 0) + 1
        const lower = val.toLowerCase()
        if (/(title|name)/.test(lower)) {
          pushUnique({ name: 'name', selector: `[data-testid="${val}"]`, type: 'text', confidence: 0.85, source: 'data-testid' })
        }
        if (/price/.test(lower)) {
          pushUnique({ name: 'price', selector: `[data-testid*="price"]`, type: 'text', confidence: 0.8, source: 'data-testid' })
        }
        if (/(review|rating|score)/.test(lower)) {
          pushUnique({ name: 'rating', selector: `[data-testid*="review"], [data-testid*="rating"], [data-testid*="score"]`, type: 'text', confidence: 0.6, source: 'data-testid' })
        }
        if (/link|title-link|url/.test(lower)) {
          pushUnique({ name: 'link', selector: `[data-testid*="link"]`, type: 'attr', attr: 'href', confidence: 0.8, source: 'data-testid' })
        }
      }

      // Try to guess list containers by repeated data-testid
      let listItemSelector: string | undefined
      const repeated = Object.entries(testidCounts)
        .filter(([, count]) => count >= 5)
        .sort((a, b) => b[1] - a[1])
      for (const [val] of repeated) {
        const selector = `[data-testid="${val}"]`
        // Verify some items contain sub-elements like title/link
        const some = Array.from(document.querySelectorAll(selector)).slice(0, 3)
        const valid = some.some((el) => el.querySelector('[data-testid*="title"], [data-testid*="name"], a'))
        if (valid) { listItemSelector = selector; break }
      }

      // Fallback list detection by class names common patterns
      if (!listItemSelector) {
        const candidates = ['.card', '.item', '.result', '.listing', '.product', '.property-card']
        for (const cand of candidates) {
          const count = document.querySelectorAll(cand).length
          if (count >= 5) { listItemSelector = cand; break }
        }
      }

      // If we think it's a list, add internal field suggestions relative to items
      if (listItemSelector) {
        const innerCandidates: Array<[string, string, 'text' | 'attr', string?]> = [
          ['name', '[data-testid="title"]', 'text'],
          ['link', 'a[data-testid="title-link"]', 'attr', 'href'],
          ['price', '[data-testid*="price"]', 'text'],
          ['rating', '[data-testid*="review"] div', 'text'],
        ]
        for (const [name, sel, type, attr] of innerCandidates) {
          if (document.querySelector(`${listItemSelector} ${sel}`)) {
            pushUnique({ name, selector: sel, type, attr, confidence: 0.9, source: 'heuristic' })
          }
        }
      }

      // Discover pagination controls
      const findNext = (): string | undefined => {
        const order = [
          'a[rel="next"]',
          'link[rel="next"]',
          'a[aria-label*="Next" i]',
          'button[aria-label*="Next" i]',
        ]
        for (const sel of order) { if (document.querySelector(sel)) return sel }
        // Avoid returning non-standard or overly broad selectors
        return undefined
      }
      const findPrev = (): string | undefined => {
        const order = [
          'a[rel="prev"]',
          'a[aria-label*="Prev" i], a[aria-label*="Previous" i]',
          'button[aria-label*="Prev" i], button[aria-label*="Previous" i]',
        ]
        for (const sel of order) { if (document.querySelector(sel)) return sel }
        return undefined
      }

      const nextButtonSelector = findNext()
      const prevButtonSelector = findPrev()
      const mode: 'single' | 'list' | 'unknown' = listItemSelector ? 'list' : (suggestions.length ? 'single' : 'unknown')
      return { mode, listItemSelector, suggestions, nextButtonSelector, prevButtonSelector }
    })

    const payload: DiscoverResult = {
      ok: true,
      mode: res.mode,
      listItemSelector: res.listItemSelector,
      suggestions: res.suggestions,
      nextButtonSelector: res.nextButtonSelector,
      prevButtonSelector: res.prevButtonSelector,
    }

    return NextResponse.json(payload)
  } catch (err: any) {
    console.error('Discover error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  } finally {
    try { await browser?.close() } catch {}
  }
}
