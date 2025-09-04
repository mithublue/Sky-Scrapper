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

type PaginationInfo = {
  type: 'infinite_scroll' | 'traditional_pagination' | 'load_more_button' | 'none'
  nextButtonSelector?: string
  prevButtonSelector?: string
  pageNumberSelectors?: string[]
  loadMoreSelector?: string
  hasNumberedPages?: boolean
  totalPagesSelector?: string
  currentPageSelector?: string
}

type DiscoverResult = {
  ok: true
  mode: 'single' | 'list' | 'unknown'
  listItemSelector?: string
  suggestions: Suggestion[]
  pagination: PaginationInfo
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

    browser = await puppeteer.launch({ 
      headless: true, 
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--no-first-run',
        '--no-default-browser-check',
        '--lang=en-US,en',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      ] 
    })
    const page = await browser.newPage()
    const navTimeout = Math.min(Math.max(timeoutMs ?? 60000, 10000), 120000)
    page.setDefaultNavigationTimeout(navTimeout)
    page.setDefaultTimeout(navTimeout)
    await page.setViewport({ width: 1366, height: 1000 })
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    })

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })
    } catch (e) {
      console.log('First attempt failed, retrying...')
      await page.goto(url, { waitUntil: 'load', timeout: navTimeout })
    }

    // Wait for dynamic content and dismiss potential overlays
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Enhanced cookie consent handling
    try {
      const consentSelectors = [
        '#onetrust-accept-btn-handler',
        'button[aria-label*="accept" i]',
        'button[class*="accept"]',
        '.cookie-accept',
        'button:contains("Accept")',
        'button:contains("OK")',
        'button:contains("同意")', // Chinese 'agree'
        'button:contains("确定")', // Chinese 'confirm'
      ]
      
      for (const sel of consentSelectors) {
        if (sel.includes(':contains')) {
          const clicked = await page.evaluate((text) => {
            const targetText = text.replace('button:contains("', '').replace('")', '')
            const buttons = Array.from(document.querySelectorAll('button'))
            const button = buttons.find(btn => {
              return (btn.textContent || '').trim().toLowerCase().includes(targetText.toLowerCase())
            }) as HTMLElement
            if (button) {
              button.click()
              return true
            }
            return false
          }, sel)
          if (clicked) break
        } else {
          const consentBtn = await page.$(sel)
          if (consentBtn) {
            await consentBtn.click()
            break
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
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

      // Fallback list detection by class names and common patterns
      if (!listItemSelector) {
        const candidates = [
          '.card', '.item', '.result', '.listing', '.product', '.property-card',
          // Alibaba specific patterns
          '.organic-offer-wrapper', '.product-item', '.search-card-container',
          '[class*="product-card"]', '[class*="offer-wrapper"]', '[class*="search-item"]',
          // Generic e-commerce patterns
          '[class*="item-card"]', '[class*="product-item"]', '[class*="listing-item"]',
          'article', '.tile', '.grid-item'
        ]
        for (const cand of candidates) {
          const count = document.querySelectorAll(cand).length
          if (count >= 3) { // Lower threshold for better detection
            listItemSelector = cand
            break
          }
        }
      }

      // If we think it's a list, add internal field suggestions relative to items
      if (listItemSelector) {
        const innerCandidates: Array<[string, string, 'text' | 'attr', string?]> = [
          // Booking.com patterns
          ['name', '[data-testid="title"]', 'text'],
          ['link', 'a[data-testid="title-link"]', 'attr', 'href'],
          ['price', '[data-testid*="price"]', 'text'],
          ['rating', '[data-testid*="review"] div', 'text'],
          // Generic e-commerce patterns
          ['title', 'h2, h3, .title, [class*="title"], .product-title', 'text'],
          ['price', '.price, [class*="price"], .product-price', 'text'],
          ['image', 'img', 'attr', 'src'],
          ['link', 'a', 'attr', 'href'],
          // Alibaba specific patterns
          ['supplier', '.supplier, .company-name, [class*="supplier"]', 'text'],
          ['description', '.description, [class*="desc"]', 'text'],
        ]
        for (const [name, sel, type, attr] of innerCandidates) {
          // Check if selector exists within list items
          const sampleItems = Array.from(document.querySelectorAll(listItemSelector)).slice(0, 3)
          const hasSelector = sampleItems.some(item => item.querySelector(sel))
          if (hasSelector) {
            pushUnique({ name, selector: sel, type, attr, confidence: 0.8, source: 'pattern-match' })
          }
        }
      }

      // Enhanced pagination discovery
      const discoverPagination = () => {
        const pagination: any = {
          type: 'none',
          nextButtonSelector: undefined,
          prevButtonSelector: undefined,
          pageNumberSelectors: [],
          loadMoreSelector: undefined,
          hasNumberedPages: false,
          totalPagesSelector: undefined,
          currentPageSelector: undefined
        }

        // Detect Next/Previous buttons with multiple strategies
        const nextSelectors = [
          'a[rel="next"]:not([disabled])',
          'link[rel="next"]',
          'a[aria-label*="Next" i]:not([disabled])',
          'button[aria-label*="Next" i]:not([disabled])',
          'a[title*="Next" i]:not([disabled])',
          'button[title*="Next" i]:not([disabled])',
          // Common class patterns
          'a.next:not([disabled])',
          'button.next:not([disabled])',
          'a.pagination-next:not([disabled])',
          'button.pagination-next:not([disabled])',
          // Text-based detection
          'a:contains("Next"):not([disabled])',
          'button:contains("Next"):not([disabled])',
          // Icon-based (common symbols)
          'a[aria-label*="►" i]:not([disabled])',
          'button[aria-label*="►" i]:not([disabled])',
          'a[title*="►" i]:not([disabled])',
          'button[title*="►" i]:not([disabled])'
        ]

        const prevSelectors = [
          'a[rel="prev"]:not([disabled])',
          'a[rel="previous"]:not([disabled])',
          'a[aria-label*="Prev" i]:not([disabled])',
          'a[aria-label*="Previous" i]:not([disabled])',
          'button[aria-label*="Prev" i]:not([disabled])',
          'button[aria-label*="Previous" i]:not([disabled])',
          'a[title*="Prev" i]:not([disabled])',
          'a[title*="Previous" i]:not([disabled])',
          'button[title*="Prev" i]:not([disabled])',
          'button[title*="Previous" i]:not([disabled])',
          // Common class patterns
          'a.prev:not([disabled])',
          'a.previous:not([disabled])',
          'button.prev:not([disabled])',
          'button.previous:not([disabled])',
          'a.pagination-prev:not([disabled])',
          'button.pagination-prev:not([disabled])',
          // Text-based detection
          'a:contains("Previous"):not([disabled])',
          'button:contains("Previous"):not([disabled])',
          'a:contains("Prev"):not([disabled])',
          'button:contains("Prev"):not([disabled])',
          // Icon-based
          'a[aria-label*="◄" i]:not([disabled])',
          'button[aria-label*="◄" i]:not([disabled])'
        ]

        // Helper function to check if element contains text (since CSS :contains doesn't work)
        const findByText = (tagName: string, textPattern: string) => {
          const elements = Array.from(document.querySelectorAll(tagName))
          return elements.find(el => {
            const text = el.textContent?.toLowerCase().trim() || ''
            return text.includes(textPattern.toLowerCase()) && !el.hasAttribute('disabled')
          })
        }

        // Find next button
        for (const sel of nextSelectors) {
          if (sel.includes(':contains')) {
            const tagName = sel.split(':')[0]
            const text = sel.match(/"([^"]+)"/)?.[1] || ''
            const element = findByText(tagName, text)
            if (element) {
              // Generate a more specific selector for this element
              const classes = element.className ? `.${element.className.split(' ').join('.')}` : ''
              const id = element.id ? `#${element.id}` : ''
              pagination.nextButtonSelector = `${tagName}${id}${classes}`.trim() || sel.replace(':contains("Next")', '').replace(':contains("►")', '')
              break
            }
          } else if (document.querySelector(sel)) {
            pagination.nextButtonSelector = sel
            break
          }
        }

        // Find previous button
        for (const sel of prevSelectors) {
          if (sel.includes(':contains')) {
            const tagName = sel.split(':')[0]
            const text = sel.match(/"([^"]+)"/)?.[1] || ''
            const element = findByText(tagName, text)
            if (element) {
              const classes = element.className ? `.${element.className.split(' ').join('.')}` : ''
              const id = element.id ? `#${element.id}` : ''
              pagination.prevButtonSelector = `${tagName}${id}${classes}`.trim() || sel.replace(':contains("Previous")', '').replace(':contains("Prev")', '').replace(':contains("◄")', '')
              break
            }
          } else if (document.querySelector(sel)) {
            pagination.prevButtonSelector = sel
            break
          }
        }

        // Detect numbered pagination
        const numberPageSelectors = [
          'a[href*="page="]',
          'a[href*="p="]',
          'button[data-page]',
          '.pagination a',
          '.pagination button',
          '.pager a',
          '.page-numbers a',
          '.page-link',
          'nav[aria-label*="pagination" i] a',
          'nav[role="navigation"] a[href*="page"]'
        ]
        
        const pageNumberElements: Element[] = []
        for (const sel of numberPageSelectors) {
          const elements = Array.from(document.querySelectorAll(sel))
          const numberedElements = elements.filter(el => {
            const text = el.textContent?.trim() || ''
            return /^\d+$/.test(text) && parseInt(text) > 0
          })
          if (numberedElements.length >= 2) {
            pagination.pageNumberSelectors.push(sel)
            pageNumberElements.push(...numberedElements)
          }
        }
        
        if (pageNumberElements.length >= 2) {
          pagination.hasNumberedPages = true
        }

        // Detect "Load More" buttons
        const loadMoreSelectors = [
          'button[aria-label*="load more" i]',
          'button[aria-label*="show more" i]',
          'button[aria-label*="view more" i]',
          'a[aria-label*="load more" i]',
          'a[aria-label*="show more" i]',
          // Text-based detection
          'button:contains("Load More")',
          'button:contains("Show More")',
          'button:contains("View More")',
          'button:contains("See More")',
          'a:contains("Load More")',
          'a:contains("Show More")',
          'a:contains("View More")',
          'a:contains("See More")',
          // Common classes
          'button.load-more',
          'button.show-more',
          'a.load-more',
          'a.show-more'
        ]

        for (const sel of loadMoreSelectors) {
          if (sel.includes(':contains')) {
            const tagName = sel.split(':')[0]
            const text = sel.match(/"([^"]+)"/)?.[1] || ''
            const element = findByText(tagName, text)
            if (element) {
              const classes = element.className ? `.${element.className.split(' ').join('.')}` : ''
              const id = element.id ? `#${element.id}` : ''
              pagination.loadMoreSelector = `${tagName}${id}${classes}`.trim() || sel.replace(/:contains\([^)]+\)/, '')
              break
            }
          } else if (document.querySelector(sel)) {
            pagination.loadMoreSelector = sel
            break
          }
        }

        // Detect current page and total pages
        const currentPageSelectors = [
          '.pagination .active',
          '.pagination .current',
          '.page-numbers.current',
          'nav[aria-label*="pagination" i] .active',
          'nav[aria-label*="pagination" i] .current',
          '[aria-current="page"]'
        ]
        
        for (const sel of currentPageSelectors) {
          if (document.querySelector(sel)) {
            pagination.currentPageSelector = sel
            break
          }
        }

        // Detect total pages indicators
        const totalPageSelectors = [
          '.pagination .total',
          '.page-count',
          'span[title*="total" i]',
          '[data-total-pages]'
        ]
        
        for (const sel of totalPageSelectors) {
          if (document.querySelector(sel)) {
            pagination.totalPagesSelector = sel
            break
          }
        }

        // Determine pagination type based on findings
        if (pagination.loadMoreSelector) {
          pagination.type = 'load_more_button'
        } else if (pagination.hasNumberedPages) {
          pagination.type = 'traditional_pagination'
        } else if (pagination.nextButtonSelector || pagination.prevButtonSelector) {
          // Check for infinite scroll indicators
          const hasInfiniteScrollIndicators = !!(document.querySelector('[data-infinite-scroll]') ||
            document.querySelector('.infinite-scroll') ||
            document.querySelector('[data-scroll-loader]') ||
            // Check for common infinite scroll libraries
            (window as any).InfiniteScroll ||
            (window as any).LazyLoad)
          
          pagination.type = hasInfiniteScrollIndicators ? 'infinite_scroll' : 'traditional_pagination'
        } else {
          // Try to detect infinite scroll by checking for scroll event listeners or lazy loading
          const hasScrollHandlers = !!(
            (window as any).addEventListener?.toString().includes('scroll') ||
            document.querySelector('[data-lazy]') ||
            document.querySelector('.lazy-load') ||
            document.querySelector('[loading="lazy"]')
          )
          
          pagination.type = hasScrollHandlers ? 'infinite_scroll' : 'none'
        }

        return pagination
      }

      const pagination = discoverPagination()
      const mode: 'single' | 'list' | 'unknown' = listItemSelector ? 'list' : (suggestions.length ? 'single' : 'unknown')
      return { mode, listItemSelector, suggestions, pagination }
    })

    const payload: DiscoverResult = {
      ok: true,
      mode: res.mode,
      listItemSelector: res.listItemSelector,
      suggestions: res.suggestions,
      pagination: res.pagination,
    }

    return NextResponse.json(payload)
  } catch (err: any) {
    console.error('Discover error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  } finally {
    try { await browser?.close() } catch {}
  }
}
