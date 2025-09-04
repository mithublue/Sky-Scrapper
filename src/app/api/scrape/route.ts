import { NextResponse } from 'next/server'
import * as puppeteer from 'puppeteer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Mode = 'single' | 'list'

type Field = {
  name: string
  selector: string
  type: 'text' | 'attr'
  attr?: string
}

// Enhanced stealth: reduce obvious automation signals
async function applyStealth(page: puppeteer.Page) {
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    
    // Add chrome runtime
    // @ts-ignore
    window.chrome = { runtime: {} }
    
    // Override language properties
    Object.defineProperty(navigator, 'language', { get: () => 'en-US' })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' })
    
    // Override permissions
    const originalQuery = (window.navigator.permissions && window.navigator.permissions.query) as any
    if (originalQuery) {
      window.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : originalQuery(parameters)
      )
    }
    
    // Override WebGL parameters to mimic real browser
    const getParameter = (WebGLRenderingContext as any).prototype.getParameter
    ;(WebGLRenderingContext as any).prototype.getParameter = function (parameter: any) {
      if (parameter === 37445) return 'Intel Inc.' // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine' // UNMASKED_RENDERER_WEBGL
      return getParameter.call(this, parameter)
    }
    
    // Override plugins to look more real
    const originalPlugins = (navigator as any).plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
      ],
    })
    
    // Remove automation scripts detection
    Object.defineProperty(document, 'hidden', { get: () => false })
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' })
    
    // Override hardwareConurrency to mimic real browser
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 })
    
    // Mock connection property
    Object.defineProperty(navigator, 'connection', {
      get: () => ({
        effectiveType: '4g',
        downlink: 2.5,
        rtt: 150
      })
    })
  })
}

// Enhanced cookie banner handling for different websites
async function acceptCookiesIfPresent(page: puppeteer.Page) {
  try {
    const selectors = [
      // OneTrust (Booking.com)
      'button#onetrust-accept-btn-handler',
      "button[aria-label='Accept']",
      "button[data-testid='accept-cookies-button']",
      "button[aria-label='Accept all']",
      "button[aria-label='I agree']",
      // Common cookie consent patterns
      "button[id*='accept']",
      "button[class*='accept']",
      "button[class*='consent']",
      "a[class*='accept']",
      // Alibaba specific patterns
      ".cookie-accept",
      "[data-role='accept']",
      "button:contains('Accept')",
      "button:contains('I Accept')",
      "button:contains('OK')",
      "button:contains('同意')", // Chinese for 'agree'
      "button:contains('确定')", // Chinese for 'confirm'
    ]
    
    for (const sel of selectors) {
      if (sel.includes(':contains')) {
        // Handle text-based selectors
        const clicked = await page.evaluate((text) => {
          const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'))
          const targetText = text.replace('button:contains(\'', '').replace('\')', '')
          const element = buttons.find(btn => {
            const btnText = (btn.textContent || '').toLowerCase().trim()
            return btnText.includes(targetText.toLowerCase())
          }) as HTMLElement
          
          if (element) {
            element.click()
            return true
          }
          return false
        }, sel)
        
        if (clicked) {
          await new Promise(r => setTimeout(r, 1000))
          return
        }
      } else {
        const btn = await page.$(sel)
        if (btn) {
          await btn.click().catch(() => {})
          await new Promise(r => setTimeout(r, 1000))
          return
        }
      }
    }
    
    // Fallback: scan visible buttons/links for accept-like text
    const clicked = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button, a[role="button"], a')) as HTMLElement[]
      const phrases = ['accept', 'i agree', 'got it', 'agree & close', 'ok', '同意', '确定', 'allow']
      for (const el of nodes) {
        const txt = (el.innerText || el.textContent || '').toLowerCase().trim()
        if (!txt || !phrases.some(p => txt.includes(p))) continue
        const rect = el.getBoundingClientRect()
        if (rect && rect.width > 0 && rect.height > 0) { el.click(); return true }
      }
      return false
    })
    if (clicked) { await new Promise(r => setTimeout(r, 1000)) }
  } catch {}
}

type PaginationStrategy = 'infinite_scroll' | 'traditional_pagination' | 'load_more_button' | 'auto' | 'none'

type ExclusionFilter = {
  fieldName: string
  existingItems: Record<string, any>[]
  matchType: 'exact' | 'contains' | 'startsWith' | 'endsWith'
}

type Body = {
  url: string
  mode: Mode
  listItemSelector?: string
  fields: Field[]
  waitForSelector?: string
  timeoutMs?: number
  limit?: number
  deepSearch?: boolean
  detailUrlFieldName?: string
  min?: number
  pages?: number
  offset?: number
  nextButtonSelector?: string
  prevButtonSelector?: string
  paginationStrategy?: PaginationStrategy
  loadMoreSelector?: string
  pageNumberSelectors?: string[]
  exclusionFilter?: ExclusionFilter
}

export async function POST(req: Request) {
  let browser: puppeteer.Browser | null = null
  try {
    const body = (await req.json()) as Body
    const { url, mode, listItemSelector, fields, waitForSelector, timeoutMs, limit, deepSearch, detailUrlFieldName, min, pages, offset, nextButtonSelector, prevButtonSelector, paginationStrategy, loadMoreSelector, pageNumberSelectors, exclusionFilter } = body

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'Valid url is required' }, { status: 400 })
    }
    if (!Array.isArray(fields) || fields.length === 0) {
      return NextResponse.json({ ok: false, error: 'At least one field is required' }, { status: 400 })
    }
    if (mode === 'list' && !listItemSelector) {
      return NextResponse.json({ ok: false, error: 'listItemSelector is required for list mode' }, { status: 400 })
    }
    if (mode === 'list' && deepSearch && !detailUrlFieldName) {
      return NextResponse.json({ ok: false, error: 'detailUrlFieldName is required when deepSearch is enabled' }, { status: 400 })
    }
    if (mode === 'list' && typeof min === 'number' && typeof limit === 'number' && min > limit) {
      return NextResponse.json({ ok: false, error: 'min cannot be greater than max (limit)' }, { status: 400 })
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
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-pings',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--lang=en-US,en',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ],
    })

    const page = await browser.newPage()
    await page.setViewport({ width: 1366, height: 1000 })
    const navTimeout = Math.min(Math.max(timeoutMs ?? 60000, 10000), 120000)
    page.setDefaultNavigationTimeout(navTimeout)
    page.setDefaultTimeout(navTimeout)
    
    // Enhanced user agent with more realistic headers
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    await page.setExtraHTTPHeaders({ 
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1'
    })

    if (mode === 'list') {
      console.log('Starting list scraping with configuration:')
      console.log('- URL:', url)
      console.log('- List selector:', listItemSelector)
      console.log('- Fields:', fields.map(f => ({ name: f.name, selector: f.selector, type: f.type, attr: f.attr })))
      console.log('- Pagination strategy:', paginationStrategy)
      if (exclusionFilter && exclusionFilter.fieldName && exclusionFilter.existingItems.length > 0) {
        console.log('- Exclusion filter:', {
          field: exclusionFilter.fieldName,
          matchType: exclusionFilter.matchType,
          existingItemsCount: exclusionFilter.existingItems.length,
          sampleItems: exclusionFilter.existingItems.slice(0, 2).map(item => ({
            [exclusionFilter.fieldName]: item[exclusionFilter.fieldName]
          }))
        })
      }
    }
    try {
      console.log(`Navigating to: ${url}`)
      await page.goto(url, { waitUntil: 'networkidle2', timeout: navTimeout })
    } catch (e) {
      console.log('First navigation attempt failed, retrying with domcontentloaded...')
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout })
      } catch (e2) {
        console.log('Second navigation attempt failed, trying load event...')
        await page.goto(url, { waitUntil: 'load', timeout: navTimeout })
      }
    }

    // Wait a bit for dynamic content to load
    await new Promise(r => setTimeout(r, 2000))

    // Attempt to accept cookie consent
    await acceptCookiesIfPresent(page)

    // Smart selector waiting with multiple fallbacks
    const effectiveWaitFor = waitForSelector ?? (mode === 'list' ? listItemSelector! : undefined)
    if (effectiveWaitFor) {
      console.log(`Waiting for selector: ${effectiveWaitFor}`)
      try {
        await page.waitForSelector(effectiveWaitFor, { visible: true, timeout: 15000 })
      } catch (e) {
        console.log(`Primary selector failed, trying alternative approaches...`)
        
        // Try waiting for any content that looks like list items
        if (mode === 'list') {
          const alternativeSelectors = [
            '[class*="product"]',
            '[class*="item"]',
            '[class*="card"]',
            '[class*="result"]',
            '[data-testid*="product"]',
            '[data-testid*="item"]',
            'article',
            '.search-result',
            '.listing'
          ]
          
          let found = false
          for (const altSel of alternativeSelectors) {
            try {
              await page.waitForSelector(altSel, { visible: true, timeout: 5000 })
              console.log(`Found alternative selector: ${altSel}`)
              found = true
              break
            } catch {}
          }
          
          if (!found) {
            console.log('No suitable selectors found, proceeding anyway...')
            // Wait a bit more for dynamic content
            await new Promise(r => setTimeout(r, 3000))
          }
        }
      }
    }

    if (mode === 'list') {
      const maxPages = (typeof pages === 'number' && isFinite(pages) && pages > 0) ? Math.floor(pages) : Number.POSITIVE_INFINITY
      const maxItems = (typeof limit === 'number' && isFinite(limit) && limit > 0) ? Math.floor(limit) : undefined
      const minItems = (typeof min === 'number' && isFinite(min) && min > 0) ? Math.floor(min) : undefined
      let skipRemaining = (typeof offset === 'number' && isFinite(offset) && offset > 0) ? Math.floor(offset) : 0

      const aggregate: Record<string, any>[] = []
      let currentPage = 1
      let workingSelector = ''
      const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
      const globalSeenItems = new Set<string>() // Global deduplication across pages

      // Auto-detect pagination strategy if not provided
      let detectedPaginationInfo: any = null
      if (paginationStrategy === 'auto' || !paginationStrategy) {
        try {
          console.log('Auto-detecting pagination strategy...')
          detectedPaginationInfo = await page.evaluate(() => {
            const info: any = {
              hasLoadMore: false,
              hasNumberedPages: false,
              hasNextButton: false,
              hasInfiniteScroll: false,
              detectedSelectors: {}
            }

            // Check for load more buttons
            const loadMorePatterns = [
              'button[aria-label*="load more" i]',
              'button[aria-label*="show more" i]',
              'a[aria-label*="load more" i]',
              '.load-more',
              '.show-more'
            ]
            
            for (const pattern of loadMorePatterns) {
              const element = document.querySelector(pattern)
              if (element) {
                info.hasLoadMore = true
                info.detectedSelectors.loadMore = pattern
                break
              }
            }

            // Check for text-based load more
            if (!info.hasLoadMore) {
              const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'))
              const loadMoreBtn = buttons.find(btn => {
                const text = (btn.textContent || '').toLowerCase().trim()
                return /\b(load more|show more|view more|see more)\b/.test(text)
              })
              if (loadMoreBtn) {
                info.hasLoadMore = true
                const classes = loadMoreBtn.className ? `.${loadMoreBtn.className.split(' ').join('.')}` : ''
                const id = loadMoreBtn.id ? `#${loadMoreBtn.id}` : ''
                const tagName = loadMoreBtn.tagName.toLowerCase()
                info.detectedSelectors.loadMore = `${tagName}${id}${classes}`.trim() || `${tagName}:contains("Load More")`
              }
            }

            // Check for numbered pagination
            const paginationPatterns = [
              '.pagination a',
              '.page-numbers a',
              'nav[aria-label*="pagination"] a',
              'a[href*="page="]'
            ]
            
            for (const pattern of paginationPatterns) {
              const elements = Array.from(document.querySelectorAll(pattern))
              const numberedElements = elements.filter(el => {
                const text = el.textContent?.trim() || ''
                return /^\d+$/.test(text) && parseInt(text) > 0
              })
              if (numberedElements.length >= 2) {
                info.hasNumberedPages = true
                info.detectedSelectors.pageNumbers = pattern
                break
              }
            }

            // Check for next button
            const nextPatterns = [
              'a[rel="next"]:not([disabled])',
              'a[aria-label*="next" i]:not([disabled])',
              'button[aria-label*="next" i]:not([disabled])',
              '.next:not([disabled])'
            ]
            
            for (const pattern of nextPatterns) {
              if (document.querySelector(pattern)) {
                info.hasNextButton = true
                info.detectedSelectors.nextButton = pattern
                break
              }
            }

            // Check for infinite scroll indicators
            info.hasInfiniteScroll = !!(
              document.querySelector('[data-infinite-scroll]') ||
              document.querySelector('.infinite-scroll') ||
              document.querySelector('[data-scroll-loader]') ||
              (window as any).InfiniteScroll ||
              (window as any).LazyLoad
            )

            return info
          })
          
          console.log('Detected pagination info:', detectedPaginationInfo)
        } catch (e) {
          console.log('Error detecting pagination:', e)
        }
      }

      const scrapeCurrentPage = async (): Promise<Record<string, any>[]> => {
        // Try primary selector first, then fallbacks
        const selectorVariants = [listItemSelector!]
        
        // Add common fallback selectors if primary fails
        if (listItemSelector?.includes(',')) {
          // If multiple selectors provided, try each one
          selectorVariants.splice(0, 1, ...listItemSelector.split(',').map(s => s.trim()))
        } else {
          // Add fallback patterns only if primary selector fails
          selectorVariants.push(
            '[class*="product"]',
            '[class*="item"]', 
            '[class*="card"]',
            '[class*="result"]',
            'article',
            '.search-result',
            '.listing'
          )
        }
        
        let elementsFound = 0
        let finalSelector = ''
        
        // Find the FIRST selector that actually returns elements (no fallback if first works)
        for (const selector of selectorVariants) {
          try {
            const count = await page.$$eval(selector, els => els.length)
            console.log(`Checking selector "${selector}": found ${count} elements`)
            if (count > 0) {
              workingSelector = selector
              finalSelector = selector
              elementsFound = count
              console.log(`✓ Using primary selector: "${selector}" (${count} elements)`) 
              break
            }
          } catch (e: any) {
            console.log(`Selector "${selector}" failed:`, e?.message || 'unknown error')
          }
        }
        
        if (!workingSelector) {
          console.log('No working selector found, returning empty array')
          return []
        }
        await page.waitForSelector(finalSelector, { visible: true }).catch(() => {
          console.log('waitForSelector failed, proceeding anyway')
        })
        
        // Debug: Check what elements we actually found
        const debugInfo = await page.evaluate((selector) => {
          const elements = Array.from(document.querySelectorAll(selector))
          // Check for potential duplicates by comparing text content
          const textContents = elements.map(el => el.textContent?.trim().substring(0, 100))
          const uniqueTexts = new Set(textContents)
          
          return {
            totalElements: elements.length,
            uniqueTextCount: uniqueTexts.size,
            hasPotentialDuplicates: elements.length !== uniqueTexts.size,
            firstElementHTML: elements[0]?.outerHTML?.substring(0, 500) + '...',
            firstElementText: elements[0]?.textContent?.substring(0, 200) + '...',
            availableSelectors: {
              titles: elements[0]?.querySelectorAll('h1, h2, h3, h4, [class*="title"], [data-testid*="title"]').length || 0,
              links: elements[0]?.querySelectorAll('a').length || 0,
              prices: elements[0]?.querySelectorAll('[class*="price"], [data-testid*="price"]').length || 0,
              images: elements[0]?.querySelectorAll('img').length || 0
            }
          }
        }, finalSelector)
        console.log('Debug info for elements:', debugInfo)
        
        if (debugInfo.hasPotentialDuplicates) {
          console.log('⚠️ Warning: Potential duplicate elements detected. This may cause duplicate results.')
        }
        // Enhanced loading and content discovery
        try {
          const getCount = async () => {
            try { return await page.$$eval(workingSelector, els => els.length) } catch { return 0 }
          }
          const remainingNeed = typeof maxItems === 'number' ? Math.max(maxItems - aggregate.length, 0) : undefined
          const desiredOnPageCount = typeof remainingNeed === 'number' ? (remainingNeed + skipRemaining) : undefined

          let count = await getCount()
          let stagnationRounds = 0

          const autoScrollToBottom = async () => {
            try {
              await page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                  let total = 0
                  const distance = 600
                  const timer = setInterval(() => {
                    const { scrollHeight } = document.body
                    window.scrollBy(0, distance)
                    total += distance
                    if (total >= scrollHeight - window.innerHeight - 200) {
                      clearInterval(timer)
                      resolve()
                    }
                  }, 120)
                })
              })
            } catch {}
          }

          const clickLoadMoreIfAvailable = async (): Promise<boolean> => {
            try {
              return await page.evaluate(() => {
                const candidates = Array.from(document.querySelectorAll('button, a[role="button"], a')) as HTMLElement[]
                const phrases = ['load more', 'see more', 'show more', 'more results', 'more properties']
                for (const el of candidates) {
                  const txt = (el.innerText || el.textContent || '').toLowerCase().trim()
                  if (!txt || !phrases.some(p => txt.includes(p))) continue
                  const rect = el.getBoundingClientRect()
                  const visible = rect && rect.width > 0 && rect.height > 0
                  if (!visible) continue
                  el.scrollIntoView({ behavior: 'auto', block: 'center' })
                  el.click()
                  return true
                }
                return false
              })
            } catch { return false }
          }

          const waitForNewResults = async (prevCount: number, timeoutMs = 10000) => {
            const start = Date.now()
            let latest = prevCount
            while (Date.now() - start < timeoutMs) {
              const c = await getCount()
              if (c > prevCount) return c
              latest = c
              await sleep(400)
            }
            return latest
          }

          while (typeof desiredOnPageCount === 'number' && count < desiredOnPageCount) {
            const before = count
            await autoScrollToBottom()
            const clicked = await clickLoadMoreIfAvailable()
            if (clicked) await sleep(1500)
            count = await waitForNewResults(before, 10000)

            if (count <= before) {
              stagnationRounds += 1
              // Nudge scroll to trigger lazy-loaders
              try { await page.evaluate(() => window.scrollBy(0, -400)) } catch {}
              await sleep(600)
              try { await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight)) } catch {}
              await sleep(1000)
              const maybe = await getCount()
              if (maybe > count) {
                count = maybe
                stagnationRounds = 0
              }
            } else {
              stagnationRounds = 0
            }

            if (stagnationRounds >= 5) break
          }

          await sleep(300)
        } catch {}

        const pageData = await page.$$eval(
          finalSelector,
          (items, fields, exclusionFilter) => {
            const elements = Array.from(items as Element[])
            console.log(`Processing ${elements.length} elements with selectors:`, fields.map((f: any) => ({ name: f.name, selector: f.selector })))
            
            // Helper function to check if item should be excluded
            const shouldExcludeItem = (item: Element, data: Record<string, any>) => {
              if (!exclusionFilter || !exclusionFilter.fieldName || !exclusionFilter.existingItems?.length) {
                return false
              }
              
              const fieldValue = data[exclusionFilter.fieldName]
              if (!fieldValue || typeof fieldValue !== 'string') {
                return false
              }
              
              const lowerFieldValue = fieldValue.toLowerCase().trim()
              
              return exclusionFilter.existingItems.some((existingItem: any) => {
                const existingFieldValue = existingItem[exclusionFilter.fieldName]
                if (!existingFieldValue || typeof existingFieldValue !== 'string') {
                  return false
                }
                
                const lowerExistingValue = existingFieldValue.toLowerCase().trim()
                
                switch (exclusionFilter.matchType) {
                  case 'exact':
                    return lowerFieldValue === lowerExistingValue
                  case 'contains':
                    return lowerFieldValue.includes(lowerExistingValue) || lowerExistingValue.includes(lowerFieldValue)
                  case 'startsWith':
                    return lowerFieldValue.startsWith(lowerExistingValue)
                  case 'endsWith':
                    return lowerFieldValue.endsWith(lowerExistingValue)
                  default:
                    return lowerFieldValue === lowerExistingValue
                }
              })
            }
            
            const extractedData = elements.map((item, index) => {
              const obj: Record<string, any> = { _index: index }
              
              for (const f of fields as any[]) {
                let value: any = null
                
                try {
                  // Handle single selector or multiple selectors separated by commas
                  const selectorList = f.selector && f.selector.includes(',') 
                    ? f.selector.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0)
                    : f.selector ? [f.selector.trim()] : []
                  
                  let target: Element | null = null
                  let usedSelector = ''
                  
                  // Try each selector until we find a match
                  for (const selector of selectorList) {
                    if (!selector) continue
                    
                    try {
                      target = item.querySelector(selector)
                      if (target) {
                        usedSelector = selector
                        break
                      }
                    } catch (e) {
                      // Continue to next selector if this one fails
                      continue
                    }
                  }
                  
                  // If no specific selector worked and we're looking for text, try the item itself
                  if (!target && f.type === 'text' && selectorList.length === 0) {
                    target = item
                    usedSelector = 'item itself'
                  }
                  
                  if (target) {
                    if (f.type === 'text') {
                      const textContent = target.textContent?.trim()
                      value = textContent && textContent.length > 0 ? textContent : null
                      if (value && index === 0) {
                        console.log(`✓ Field '${f.name}' extracted using '${usedSelector}': "${value.substring(0, 50)}${value.length > 50 ? '...' : ''}"`)
                      }
                    } else if (f.type === 'attr' && f.attr) {
                      const attrValue = target.getAttribute(f.attr)
                      if (attrValue) {
                        // Handle relative URLs for href attributes
                        if (f.attr === 'href' && !attrValue.startsWith('http')) {
                          try {
                            value = new URL(attrValue, window.location.href).href
                          } catch {
                            value = attrValue
                          }
                        } else {
                          value = attrValue
                        }
                        
                        if (index === 0) {
                          console.log(`✓ Field '${f.name}' attribute '${f.attr}' extracted using '${usedSelector}': "${value.substring(0, 50)}${value.length > 50 ? '...' : ''}"`)
                        }
                      }
                    }
                  } else {
                    if (index === 0) {
                      console.log(`✗ Field '${f.name}' not found. Tried selectors: ${selectorList.join(', ')}`)
                      // Debug: show available elements in the first item
                      const availableElements = {
                        allElements: item.querySelectorAll('*').length,
                        headings: Array.from(item.querySelectorAll('h1, h2, h3, h4, h5')).map(el => el.tagName + (el.className ? '.' + el.className : '')),
                        links: Array.from(item.querySelectorAll('a')).map(el => 'a' + (el.className ? '.' + el.className : '') + (el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]' : '')),
                        dataTestIds: Array.from(item.querySelectorAll('[data-testid]')).map(el => el.tagName.toLowerCase() + '[data-testid="' + el.getAttribute('data-testid') + '"]'),
                        spans: Array.from(item.querySelectorAll('span')).slice(0, 5).map(el => 'span' + (el.className ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') + (el.getAttribute('data-testid') ? '[data-testid="' + el.getAttribute('data-testid') + '"]' : ''))
                      }
                      console.log(`Available elements in first item for '${f.name}':`, availableElements)
                    }
                  }
                } catch (e) {
                  console.log(`Error extracting field ${f.name}:`, e)
                }
                
                obj[f.name] = value
              }
              
              return obj
            })
            
            // Deduplicate based on content similarity
            const deduplicatedData = []
            const seenItems = new Set()
            
            for (const item of extractedData) {
              // Create a content hash for deduplication (using multiple fields if available)
              const contentFields = fields.map((f: any) => f.name)
              const contentHash = contentFields
                .map((fieldName: string) => String(item[fieldName] || '').trim())
                .join('|')
                .toLowerCase()
              
              if (!seenItems.has(contentHash) && contentHash !== '|'.repeat(contentFields.length - 1)) {
                seenItems.add(contentHash)
                deduplicatedData.push(item)
              }
            }
            
            const duplicatesRemoved = extractedData.length - deduplicatedData.length
            if (duplicatesRemoved > 0) {
              console.log(`✓ Removed ${duplicatesRemoved} duplicate items during deduplication`)
            }
            
            // Apply exclusion filter to deduplicated data
            if (exclusionFilter && exclusionFilter.fieldName && exclusionFilter.existingItems?.length) {
              const beforeCount = deduplicatedData.length
              const filteredData = deduplicatedData.filter((item) => !shouldExcludeItem(elements[item._index], item))
              const afterCount = filteredData.length
              const excludedCount = beforeCount - afterCount
              
              if (excludedCount > 0) {
                console.log(`✓ Exclusion filter applied: excluded ${excludedCount} items based on field '${exclusionFilter.fieldName}' with ${exclusionFilter.matchType} match against ${exclusionFilter.existingItems.length} existing items`)
              }
              
              return filteredData
            }
            
            return deduplicatedData
          },
          fields,
          exclusionFilter
        )

        // Apply global offset skipping across pages
        let processed = pageData
        if (skipRemaining > 0) {
          if (processed.length <= skipRemaining) {
            skipRemaining -= processed.length
            processed = []
          } else {
            processed = processed.slice(skipRemaining)
            skipRemaining = 0
          }
        }

        // Apply cap for remaining needed items (respect min/max)
        const needed = (() => {
          const maxNeed = typeof maxItems === 'number' ? Math.max(maxItems - aggregate.length, 0) : Infinity
          const minNeed = typeof minItems === 'number' ? Math.max(minItems - aggregate.length, 0) : 0
          // If max is set, cap by max; else if only min is set, allow more than min but we target at least min
          return Math.min(maxNeed, Infinity) === Infinity ? (minNeed > 0 ? processed.length : processed.length) : Math.min(maxNeed, processed.length)
        })()
        if (typeof maxItems === 'number') {
          processed = processed.slice(0, needed)
        }
        return processed
      }

      const getListSnapshot = async () => {
        try {
          const currentSelector = workingSelector || listItemSelector!
          const snapshot = await page.evaluate((sel) => {
            // Try multiple selectors if provided
            const selectors = sel.includes(',') ? sel.split(',').map((s: string) => s.trim()) : [sel]
            let items: Element[] = []
            
            for (const selector of selectors) {
              try {
                items = Array.from(document.querySelectorAll(selector))
                if (items.length > 0) break
              } catch {}
            }
            
            const firstText = (items[0]?.textContent || '').slice(0, 80)
            return { href: location.href, count: items.length, firstText }
          }, currentSelector)
          return snapshot as { href: string; count: number; firstText: string }
        } catch {
          return { href: '', count: 0, firstText: '' }
        }
      }

      // Enhanced pagination navigation with multiple strategies
      const gotoNextPage = async (): Promise<boolean> => {
        try {
          const before = await getListSnapshot()
          const strategy = paginationStrategy || 'auto'

          // Auto-detect strategy if not specified
          let detectedStrategy = strategy
          let effectiveLoadMoreSelector = loadMoreSelector
          let effectivePageNumberSelectors = pageNumberSelectors
          let effectiveNextButtonSelector = nextButtonSelector
          
          if (strategy === 'auto') {
            // Use detected pagination info if available
            if (detectedPaginationInfo) {
              if (detectedPaginationInfo.hasLoadMore) {
                detectedStrategy = 'load_more_button'
                // Update selectors from detection
                if (!loadMoreSelector && detectedPaginationInfo.detectedSelectors.loadMore) {
                  effectiveLoadMoreSelector = detectedPaginationInfo.detectedSelectors.loadMore
                }
              } else if (detectedPaginationInfo.hasNumberedPages) {
                detectedStrategy = 'traditional_pagination'
                if (!pageNumberSelectors && detectedPaginationInfo.detectedSelectors.pageNumbers) {
                  effectivePageNumberSelectors = [detectedPaginationInfo.detectedSelectors.pageNumbers]
                }
              } else if (detectedPaginationInfo.hasNextButton) {
                detectedStrategy = 'traditional_pagination'
                if (!nextButtonSelector && detectedPaginationInfo.detectedSelectors.nextButton) {
                  effectiveNextButtonSelector = detectedPaginationInfo.detectedSelectors.nextButton
                }
              } else if (detectedPaginationInfo.hasInfiniteScroll) {
                detectedStrategy = 'infinite_scroll'
              } else {
                detectedStrategy = 'infinite_scroll' // Default fallback
              }
            } else {
              // Fallback detection if page evaluation failed
              if (loadMoreSelector && await page.$(loadMoreSelector)) {
                detectedStrategy = 'load_more_button'
              } else if (pageNumberSelectors?.length && await page.$(pageNumberSelectors[0])) {
                detectedStrategy = 'traditional_pagination'
              } else if (nextButtonSelector && await page.$(nextButtonSelector)) {
                detectedStrategy = 'traditional_pagination'
              } else {
                detectedStrategy = 'infinite_scroll'
              }
            }
          }

          console.log(`Using pagination strategy: ${detectedStrategy}`)

          // Strategy: Load More Button
          if (detectedStrategy === 'load_more_button') {
            const success = await handleLoadMoreStrategy()
            if (success) return success
            // Fallback to other strategies if load more fails
            detectedStrategy = 'traditional_pagination'
          }

          // Strategy: Traditional Pagination (numbered pages or next/prev)
          if (detectedStrategy === 'traditional_pagination') {
            const success = await handleTraditionalPagination()
            if (success) return success
            // Fallback to infinite scroll if traditional pagination fails
            detectedStrategy = 'infinite_scroll'
          }

          // Strategy: Infinite Scroll
          if (detectedStrategy === 'infinite_scroll') {
            return await handleInfiniteScroll()
          }

          return false

          // Strategy implementations
          async function handleLoadMoreStrategy(): Promise<boolean> {
            try {
              const selector = effectiveLoadMoreSelector || 'button:contains("Load More"), button:contains("Show More"), a:contains("Load More")'
              
              // Try to find and click load more button
              const success = await page.evaluate((sel) => {
                // Handle :contains selectors manually
                if (sel.includes(':contains')) {
                  const tagName = sel.split(':')[0]
                  const textPattern = sel.match(/"([^"]+)"/)?.[1]?.toLowerCase() || ''
                  const elements = Array.from(document.querySelectorAll(tagName))
                  const element = elements.find(el => {
                    const text = (el.textContent || '').toLowerCase().trim()
                    return text.includes(textPattern)
                  }) as HTMLElement
                  
                  if (element) {
                    element.scrollIntoView({ behavior: 'auto', block: 'center' })
                    element.click()
                    return true
                  }
                  return false
                } else {
                  const el = document.querySelector(sel) as HTMLElement
                  if (el) {
                    el.scrollIntoView({ behavior: 'auto', block: 'center' })
                    el.click()
                    return true
                  }
                  return false
                }
              }, selector)

              if (success) {
                await sleep(2000) // Wait for content to load
                
                // Wait for list content change
                const started = Date.now()
                while (Date.now() - started < 10000) {
                  const after = await getListSnapshot()
                  if (after.count !== before.count || after.firstText !== before.firstText) {
                    return true
                  }
                  await sleep(500)
                }
              }
              return false
            } catch {
              return false
            }
          }

          async function handleTraditionalPagination(): Promise<boolean> {
            try {
              // Try numbered pagination first
              if (effectivePageNumberSelectors?.length) {
                for (const selector of effectivePageNumberSelectors) {
                  const success = await handleNumberedPagination(selector)
                  if (success) return true
                }
              }

              // Try next button navigation
              return await handleNextButtonNavigation()
            } catch {
              return false
            }
          }

          async function handleNumberedPagination(selector: string): Promise<boolean> {
            try {
              const nextPageNumber = await page.evaluate((sel) => {
                const currentPageEl = document.querySelector('.pagination .active, .pagination .current, [aria-current="page"]')
                const currentPage = currentPageEl ? parseInt(currentPageEl.textContent || '1') : 1
                const nextPage = currentPage + 1
                
                // Find the next page link
                const elements = Array.from(document.querySelectorAll(sel))
                const nextPageEl = elements.find(el => {
                  const text = el.textContent?.trim() || ''
                  return text === nextPage.toString()
                }) as HTMLElement
                
                if (nextPageEl) {
                  nextPageEl.click()
                  return nextPage
                }
                return null
              }, selector)

              if (nextPageNumber) {
                try {
                  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
                  return true
                } catch {
                  // If no navigation, check for content change
                  const started = Date.now()
                  while (Date.now() - started < 8000) {
                    const after = await getListSnapshot()
                    if (after.count !== before.count || after.firstText !== before.firstText) {
                      return true
                    }
                    await sleep(500)
                  }
                }
              }
              return false
            } catch {
              return false
            }
          }

          async function handleNextButtonNavigation(): Promise<boolean> {
            try {
              // Use provided nextButtonSelector or detect automatically
              const selectors = effectiveNextButtonSelector ? [effectiveNextButtonSelector] : [
                'a[rel="next"]:not([disabled])',
                'link[rel="next"]',
                'a[aria-label*="Next" i]:not([disabled])',
                'button[aria-label*="Next" i]:not([disabled])',
                'a.next:not([disabled])',
                'button.next:not([disabled])'
              ]

              for (const sel of selectors) {
                const success = await page.evaluate((selector) => {
                  const el = document.querySelector(selector) as HTMLElement
                  if (el && !el.hasAttribute('disabled')) {
                    el.click()
                    return true
                  }
                  return false
                }, sel)

                if (success) {
                  try {
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
                    return true
                  } catch {
                    // Check for content change without navigation
                    const started = Date.now()
                    while (Date.now() - started < 8000) {
                      const after = await getListSnapshot()
                      if (after.href !== before.href || after.count !== before.count || after.firstText !== before.firstText) {
                        return true
                      }
                      await sleep(500)
                    }
                  }
                }
              }
              return false
            } catch {
              return false
            }
          }

          async function handleInfiniteScroll(): Promise<boolean> {
            try {
              // Perform auto-scroll to trigger infinite loading
              await page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                  let total = 0
                  const distance = 600
                  const timer = setInterval(() => {
                    const { scrollHeight } = document.body
                    window.scrollBy(0, distance)
                    total += distance
                    if (total >= scrollHeight - window.innerHeight - 200) {
                      clearInterval(timer)
                      resolve()
                    }
                  }, 120)
                })
              })
              
              // Try clicking load more if available
              const loadMoreClicked = await page.evaluate(() => {
                const candidates = Array.from(document.querySelectorAll('button, a[role="button"], a')) as HTMLElement[]
                const phrases = ['load more', 'see more', 'show more', 'more results', 'more properties']
                for (const el of candidates) {
                  const txt = (el.innerText || el.textContent || '').toLowerCase().trim()
                  if (!txt || !phrases.some(p => txt.includes(p))) continue
                  const rect = el.getBoundingClientRect()
                  if (rect && rect.width > 0 && rect.height > 0) { el.click(); return true }
                }
                return false
              })
              
              if (loadMoreClicked) {
                await sleep(2000)
              }
              
              // Wait for new content
              const started = Date.now()
              let latest = before.count
              while (Date.now() - started < 8000) {
                const current = await getListSnapshot()
                if (current.count > before.count) return true
                latest = current.count
                await sleep(400)
              }
              return latest > before.count
            } catch {
              return false
            }
          }

        } catch {
          return false
        }
      }

      // Scrape pages until we satisfy constraints or pages exhausted
      while (true) {
        const batch = await scrapeCurrentPage()
        
        // Apply global deduplication across pages
        const globallyFilteredBatch = []
        for (const item of batch) {
          // Create content hash for global deduplication
          const contentFields = fields.map(f => f.name)
          const contentHash = contentFields
            .map(fieldName => String(item[fieldName] || '').trim())
            .join('|')
            .toLowerCase()
          
          if (!globalSeenItems.has(contentHash) && contentHash !== '|'.repeat(contentFields.length - 1)) {
            globalSeenItems.add(contentHash)
            globallyFilteredBatch.push(item)
          }
        }
        
        const duplicatesSkipped = batch.length - globallyFilteredBatch.length
        if (duplicatesSkipped > 0) {
          console.log(`✓ Skipped ${duplicatesSkipped} duplicate items across pages`)
        }
        
        aggregate.push(...globallyFilteredBatch)

        // Stop if reached max items
        if (typeof maxItems === 'number' && aggregate.length >= maxItems) break

        // If only a min is provided (no max), stop as soon as we reach min
        if (typeof maxItems !== 'number' && typeof minItems === 'number' && aggregate.length >= minItems) break

        if (currentPage >= maxPages) break
        currentPage += 1
        const moved = await gotoNextPage()
        if (!moved) break
        // Optional wait for either custom waitForSelector or listItemSelector on new page
        const waitSel = waitForSelector ?? listItemSelector!
        try { await page.waitForSelector(waitSel, { visible: true }) } catch {}
      }

      const data = typeof maxItems === 'number' ? aggregate.slice(0, maxItems) : aggregate

      // If deepSearch is enabled, iterate each item URL and merge detail page data
      if (deepSearch && detailUrlFieldName) {
        for (let i = 0; i < data.length; i++) {
          try {
            const linkRaw = data[i]?.[detailUrlFieldName]
            if (!linkRaw || typeof linkRaw !== 'string') continue
            let targetHref: string
            try {
              targetHref = new URL(linkRaw, url).href
            } catch {
              continue
            }

            try {
              await page.goto(targetHref, { waitUntil: 'domcontentloaded' })
            } catch {
              // retry once
              try { await page.goto(targetHref, { waitUntil: 'domcontentloaded' }) } catch { continue }
            }

            const detailWaitFor = waitForSelector
            if (detailWaitFor) {
              try { await page.waitForSelector(detailWaitFor, { visible: true }) } catch {}
            }

            // Extract the same fields again on the detail page and merge
            const detailResult: Record<string, any> = {}
            for (const f of fields) {
              try {
                if (f.type === 'text') {
                  const text = await page.$eval(f.selector, (el) => el.textContent?.trim() ?? null)
                  detailResult[f.name] = text ?? null
                } else if (f.type === 'attr' && f.attr) {
                  const attrVal = await page.$eval(
                    f.selector,
                    (el, attr) => el.getAttribute(attr as string),
                    f.attr,
                  )
                  detailResult[f.name] = attrVal ?? null
                } else {
                  detailResult[f.name] = null
                }
              } catch {
                detailResult[f.name] = data[i]?.[f.name] ?? null
              }
            }
            data[i] = { ...data[i], ...detailResult, _detailUrl: targetHref }
          } catch (e) {
            // swallow per-item errors to keep other results
          }
        }
      }

      return NextResponse.json({ ok: true, mode, count: data.length, data })
    }

    // Single mode
    const result: Record<string, any> = {}
    for (const f of fields) {
      try {
        if (f.type === 'text') {
          const text = await page.$eval(f.selector, (el) => el.textContent?.trim() ?? null)
          result[f.name] = text ?? null
        } else if (f.type === 'attr' && f.attr) {
          const attrVal = await page.$eval(
            f.selector,
            (el, attr) => el.getAttribute(attr as string),
            f.attr,
          )
          result[f.name] = attrVal ?? null
        } else {
          result[f.name] = null
        }
      } catch (e) {
        result[f.name] = null
      }
    }

    return NextResponse.json({ ok: true, mode, data: result })
  } catch (err: any) {
    console.error('Scrape error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Unknown error' }, { status: 500 })
  } finally {
    try {
      await browser?.close()
    } catch {}
  }
}
